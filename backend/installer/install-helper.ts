// Install helper (ADR-0012, contract installer-cli.md): all file I/O of the bootstrap installer.
// Inputs arrive as NUL-terminated name=value records on stdin. Nothing sensitive is ever printed.
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { __internals } from "../plugin/azdo-remote-config.ts";
import {
  isPlainObject,
  PLACEHOLDER_KEY,
  planUpdate,
  renderFresh,
  renderUpdated,
  storedApiKey,
  validateInputs,
} from "./personal-config-edit.ts";
import type { UpdateErrorCode, Values } from "./personal-config-edit.ts";
import { formatSmoke, pickSmokeEnv, runSmoke, smokeFailed } from "./smoke.ts";

const MAX_STDIN = 64 * 1024;
const MAX_CONFIG = 1024 * 1024;
const RECORD_NAMES = ["org", "project", "repo", "path", "branch", "mode", "apiKey"];
const OPTIONAL_RECORDS = ["smoke"];
const OTHER_CONFIGS = ["kilo.json", "opencode.json", "opencode.jsonc", "config.json"];
const IS_WINDOWS = process.platform === "win32";

class InstallError extends Error {
  readonly exitCode: number;
  constructor(exitCode: number, message: string) {
    super(message);
    this.exitCode = exitCode;
  }
}

const usageError = (message: string) => new InstallError(2, message);
const failure = (message: string) => new InstallError(3, message);
const badHelperInput = () => failure("internal error (bad helper input)");

const UPDATE_MESSAGES: Record<UpdateErrorCode, string> = {
  "plugin-not-array": 'the existing "plugin" setting is not an array; fix it, then re-run.',
  "provider-not-object": 'the existing "provider" setting is not an object; fix it, then re-run.',
  "bifrost-not-object": 'the existing "provider.bifrost" setting is not an object; fix it, then re-run.',
  "options-not-object": 'the existing "provider.bifrost.options" setting is not an object; fix it, then re-run.',
};

// ---- stdin ----

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_STDIN) throw badHelperInput();
    chunks.push(buffer);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw badHelperInput();
  }
}

function parseRecords(text: string): Record<string, string> {
  if (text !== "" && !text.endsWith("\0")) throw badHelperInput();
  const records: Record<string, string> = {};
  for (const record of text === "" ? [] : text.slice(0, -1).split("\0")) {
    const eq = record.indexOf("=");
    if (eq === -1) throw badHelperInput();
    const name = record.slice(0, eq);
    if ((!RECORD_NAMES.includes(name) && !OPTIONAL_RECORDS.includes(name)) || Object.hasOwn(records, name)) {
      throw badHelperInput();
    }
    records[name] = record.slice(eq + 1);
  }
  if (!RECORD_NAMES.every((name) => Object.hasOwn(records, name))) throw badHelperInput();
  if (Object.hasOwn(records, "smoke") && records["smoke"] !== "on" && records["smoke"] !== "off") {
    throw badHelperInput();
  }
  return records;
}

// ---- file system helpers ----

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw err;
  }
}

function refuse(path: string): InstallError {
  return failure(`${path} is not a regular file or directory (symlinks are not followed); update it manually.`);
}

function checkedFile(path: string): Stats | null {
  const stat = lstatOrNull(path);
  if (stat !== null && !stat.isFile()) throw refuse(path);
  return stat;
}

function checkedDir(path: string): Stats | null {
  const stat = lstatOrNull(path);
  if (stat !== null && !stat.isDirectory()) throw refuse(path);
  return stat;
}

function readBounded(path: string, stat: Stats): Buffer {
  if (stat.size > MAX_CONFIG) throw failure(`${path} is larger than 1 MiB; fix or move it, then re-run.`);
  const bytes = readFileSync(path);
  if (bytes.length > MAX_CONFIG) throw failure(`${path} is larger than 1 MiB; fix or move it, then re-run.`);
  return bytes;
}

function writeAtomic(dir: string, name: string, data: string | Buffer, mode: number): void {
  const temp = join(dir, `.${name}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`);
  try {
    writeFileSync(temp, data, { flag: "wx", mode });
    if (!IS_WINDOWS) chmodSync(temp, mode);
    renameSync(temp, join(dir, name));
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}

function stripGroupOtherWrite(dir: string): void {
  if (IS_WINDOWS) return;
  const mode = lstatSync(dir).mode & 0o777;
  if ((mode & 0o022) !== 0) chmodSync(dir, mode & ~0o022);
}

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function writeBackup(dir: string, bytes: Buffer): string {
  const base = `kilo.jsonc.bak-${utcStamp(new Date())}`;
  for (let n = 0; ; n++) {
    const path = join(dir, n === 0 ? base : `${base}-${n}`);
    try {
      writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
    if (!IS_WINDOWS) chmodSync(path, 0o600);
    return path;
  }
}

// ---- planning (read-only phase) ----

interface Plan {
  configDir: string;
  azdoDir: string;
  pluginPath: string;
  configPath: string;
  pluginSource: Buffer;
  pluginDestination: Buffer | null;
  configExisting: Buffer | null;
  configExistingMode: number;
  configText: string | null;
  isFreshConfig: boolean;
  effectiveApiKey: unknown;
  droppedOptions: string[];
  needsKeyHint: boolean;
  warnings: string[];
}

function resolveConfigDir(): string {
  const xdg = process.env["XDG_CONFIG_HOME"] ?? "";
  if (xdg === "") return join(homedir(), ".config", "kilo");
  if (!isAbsolute(xdg)) throw usageError("XDG_CONFIG_HOME must be an absolute path.");
  return join(xdg, "kilo");
}

function readSource(relative: string): Buffer {
  try {
    return readFileSync(new URL(relative, import.meta.url));
  } catch {
    throw failure("installer sources are missing (expected ../plugin and ../personal-config next to installer/).");
  }
}

function parseExisting(path: string, bytes: Buffer): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = __internals.parseJsonc(bytes.toString("utf8"));
  } catch (err) {
    const detail = err instanceof Error && err.message.startsWith("Invalid JSONC: ") ? err.message.slice(15) : "parse error";
    throw failure(`${path} is not valid JSONC (${detail}); fix or move it, then re-run.`);
  }
  if (!isPlainObject(parsed)) throw failure(`${path} is not a JSON object at the top level; fix or move it, then re-run.`);
  return parsed;
}

function autoLoadedWarnings(configDir: string): string[] {
  const warnings: string[] = [];
  for (const folder of ["plugin", "plugins"]) {
    const dir = join(configDir, folder);
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names.filter((n) => n.startsWith("azdo-remote-config."))) {
      warnings.push(`${join(dir, name)} is auto-loaded by Kilo and would load the plugin twice; remove it.`);
    }
  }
  return warnings;
}

function otherConfigWarnings(configDir: string): string[] {
  const warnings: string[] = [];
  for (const name of OTHER_CONFIGS) {
    const path = join(configDir, name);
    try {
      const stat = lstatOrNull(path);
      if (stat === null || !stat.isFile() || stat.size > MAX_CONFIG) continue;
      if (readFileSync(path, "utf8").includes("azdo-remote-config")) {
        warnings.push(`${path} also references azdo-remote-config; Kilo may load the plugin twice.`);
      }
    } catch {
      continue;
    }
  }
  return warnings;
}

function planConfig(plan: Plan, values: Values, apiKey: string | undefined): void {
  const existingStat = checkedFile(plan.configPath);
  if (existingStat === null) {
    const template = readSource("../personal-config/kilo.jsonc").toString("utf8");
    try {
      plan.configText = renderFresh(template, values, apiKey);
    } catch {
      throw failure("internal error (personal config template does not match the installer).");
    }
    const effectiveKey = apiKey ?? PLACEHOLDER_KEY;
    plan.isFreshConfig = true;
    plan.effectiveApiKey = effectiveKey;
    plan.needsKeyHint = effectiveKey === PLACEHOLDER_KEY;
    return;
  }
  plan.configExisting = readBounded(plan.configPath, existingStat);
  plan.configExistingMode = existingStat.mode & 0o777;
  const existing = parseExisting(plan.configPath, plan.configExisting);
  const update = planUpdate(existing, values, apiKey);
  if (!update.ok) throw failure(`${plan.configPath}: ${UPDATE_MESSAGES[update.error]}`);
  const effectiveKey = storedApiKey(update.result);
  plan.droppedOptions = update.droppedOptions;
  plan.effectiveApiKey = effectiveKey;
  plan.needsKeyHint = effectiveKey === PLACEHOLDER_KEY;
  plan.configText = update.changed ? renderUpdated(update.result) : null;
}

function buildPlan(values: Values, apiKey: string | undefined): Plan {
  const configDir = resolveConfigDir();
  const azdoDir = join(configDir, "azdo");
  const plan: Plan = {
    configDir,
    azdoDir,
    pluginPath: join(azdoDir, "azdo-remote-config.ts"),
    configPath: join(configDir, "kilo.jsonc"),
    pluginSource: readSource("../plugin/azdo-remote-config.ts"),
    pluginDestination: null,
    configExisting: null,
    configExistingMode: 0o600,
    configText: null,
    isFreshConfig: false,
    effectiveApiKey: PLACEHOLDER_KEY,
    droppedOptions: [],
    needsKeyHint: false,
    warnings: [],
  };
  if (checkedDir(configDir) !== null) {
    if (checkedDir(azdoDir) !== null) {
      const destination = checkedFile(plan.pluginPath);
      if (destination !== null) plan.pluginDestination = readFileSync(plan.pluginPath);
    }
    planConfig(plan, values, apiKey);
    plan.warnings = [...autoLoadedWarnings(configDir), ...otherConfigWarnings(configDir)];
  } else {
    planConfig(plan, values, apiKey);
  }
  return plan;
}

// ---- write phase ----

function applyPlan(plan: Plan): string[] {
  const lines: string[] = [];
  mkdirSync(plan.azdoDir, { recursive: true, mode: 0o700 });
  stripGroupOtherWrite(plan.configDir);
  stripGroupOtherWrite(plan.azdoDir);

  if (plan.pluginDestination !== null && plan.pluginDestination.equals(plan.pluginSource)) {
    lines.push(`Plugin already up to date: ${plan.pluginPath}`);
  } else {
    writeAtomic(plan.azdoDir, "azdo-remote-config.ts", plan.pluginSource, 0o644);
    lines.push(`Installed plugin: ${plan.pluginPath}`);
  }

  if (plan.configText === null) {
    if (!IS_WINDOWS && plan.configExistingMode !== 0o600) chmodSync(plan.configPath, 0o600);
    lines.push(`Personal config already up to date: ${plan.configPath}`);
    return lines;
  }
  if (plan.configExisting !== null) {
    lines.push(`Backup of the previous personal config: ${writeBackup(plan.configDir, plan.configExisting)}`);
  }
  writeAtomic(plan.configDir, "kilo.jsonc", plan.configText, 0o600);
  lines.push(`${plan.isFreshConfig ? "Created" : "Updated"} personal config: ${plan.configPath}`);
  return lines;
}

// ---- main ----

function toMessage(err: unknown): { exitCode: number; message: string } {
  if (err instanceof InstallError) return { exitCode: err.exitCode, message: err.message };
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const suffix = typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : "";
  return { exitCode: 3, message: `file system or internal error${suffix}.` };
}

async function run(): Promise<void> {
  const records = parseRecords(await readStdin());
  const validated = validateInputs(records);
  if (!validated.ok) {
    const subject = validated.name === "KILO_BIFROST_KEY" ? validated.name : `invalid value for --${validated.name}:`;
    throw usageError(`${subject} ${validated.reason}`);
  }
  const plan = buildPlan(validated.values, validated.apiKey);
  const warnings = [...plan.warnings];
  if (validated.apiKeyLooksUnusual) warnings.push("the Bifrost virtual key does not start with sk-bf-; check it.");
  const lines = applyPlan(plan);
  for (const warning of warnings) console.error(`install.sh: warning: ${warning}`);
  for (const line of lines) console.log(line);
  if (plan.droppedOptions.length > 0) {
    console.log(`Note: dropped plugin options from the previous entry: ${plan.droppedOptions.join(", ")}`);
  }
  if (plan.needsKeyHint) {
    console.log(
      `Set your Bifrost virtual key: re-run with KILO_BIFROST_KEY set, or edit provider.bifrost.options.apiKey in ${plan.configPath}.`,
    );
  }
  if (records["smoke"] === "on") {
    let failed = true;
    try {
      const report = await runSmoke(validated.values, plan.effectiveApiKey, { env: pickSmokeEnv(process.env) });
      for (const line of formatSmoke(report)) console.log(line);
      failed = smokeFailed(report);
    } catch {
      failed = true;
    }
    console.log("Done.");
    if (failed) {
      console.error("install.sh: error: smoke test failed; the installation was kept.");
      process.exitCode = 4;
    }
    return;
  }
  console.log("Done.");
}

try {
  await run();
} catch (err) {
  const { exitCode, message } = toMessage(err);
  console.error(`install.sh: error: ${message}`);
  if (exitCode === 2) console.error("Run install.sh --help for usage.");
  process.exitCode = exitCode;
}
