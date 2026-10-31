// Test-only stand-in for one Kilo start: loads the INSTALLED plugin and runs server() and the config hook.
// Never imported by product code. See docs/architecture/contracts/e2e-harness.md section 1.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { __internals } from "../../../plugin/azdo-remote-config.ts";

interface Entry {
  source: "config" | "auto";
  spec: string;
  resolved: string;
  options: unknown;
}

class Misuse extends Error {}
class PhaseError extends Error {
  phase: "load" | "server" | "hook";
  constructor(phase: "load" | "server" | "hook") {
    super(phase);
    this.phase = phase;
  }
}

class FakeApp {
  records: unknown[];
  constructor(records: unknown[]) {
    this.records = records;
  }
  log(args: unknown) {
    this.records.push(JSON.parse(JSON.stringify(args)));
    return Promise.resolve(true);
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseArgs(argv: string[]): string {
  const out = argv[0] === "--out" ? argv[1] : undefined;
  if (argv.length !== 2 || out === undefined || out === "") throw new Misuse("usage");
  return out;
}

function guardPreload(): void {
  const fetchFn = globalThis.fetch;
  if ((process.env["KILO_TEST_FAKE_NET"] ?? "") === "" || typeof fetchFn !== "function" || fetchFn.name !== "fakeFetch") {
    throw new Misuse("fake network preload missing");
  }
}

function findConfigDir(): string {
  const xdg = process.env["XDG_CONFIG_HOME"] ?? "";
  return xdg !== "" && isAbsolute(xdg) ? join(xdg, "kilo") : join(homedir(), ".config", "kilo");
}

function readConfig(configDir: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = __internals.parseJsonc(readFileSync(join(configDir, "kilo.jsonc"), "utf8"));
  } catch {
    throw new Misuse("personal config unreadable");
  }
  if (!isPlainObject(parsed)) throw new Misuse("personal config invalid");
  return parsed;
}

function resolveSpec(configDir: string, spec: string): string {
  if (spec.startsWith("./") || spec.startsWith("../")) return resolve(configDir, spec);
  if (isAbsolute(spec)) return spec;
  if (spec.startsWith("file:")) return fileURLToPath(spec);
  throw new Misuse("unsupported plugin spec");
}

function configEntries(configDir: string, config: Record<string, unknown>): Entry[] {
  const plugin = config["plugin"] ?? [];
  if (!Array.isArray(plugin)) throw new Misuse("plugin is not an array");
  return plugin.map((item: unknown): Entry => {
    const spec = Array.isArray(item) ? item[0] : item;
    if (typeof spec !== "string") throw new Misuse("unsupported plugin spec");
    const options: unknown = Array.isArray(item) ? item[1] : undefined;
    return { source: "config", spec, resolved: resolveSpec(configDir, spec), options };
  });
}

function autoEntries(configDir: string): Entry[] {
  const out: Entry[] = [];
  for (const dirName of ["plugin", "plugins"]) {
    const dir = join(configDir, dirName);
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const full = join(dir, name);
      if (/\.(ts|js|mts|mjs)$/.test(name) && statSync(full).isFile()) {
        out.push({ source: "auto", spec: full, resolved: full, options: undefined });
      }
    }
  }
  return out;
}

interface Hooks {
  config?: (config: Record<string, unknown>) => unknown;
}
interface PluginModule {
  default?: { server?: (input: unknown, options: unknown) => Promise<Hooks> | Hooks };
}

async function run(out: string): Promise<void> {
  guardPreload();
  const configDir = findConfigDir();
  const config = readConfig(configDir);
  const initialConfig = structuredClone(config);
  const entries = [...configEntries(configDir, config), ...autoEntries(configDir)];
  const logs: unknown[] = [];
  const input = { client: { app: new FakeApp(logs) }, directory: process.cwd(), worktree: process.cwd() };
  let serverCalls = 0;
  let hookCalls = 0;
  const allHooks: Hooks[] = [];
  for (const entry of entries) {
    let mod: PluginModule;
    try {
      mod = (await import(pathToFileURL(entry.resolved).href)) as PluginModule;
    } catch {
      throw new PhaseError("load");
    }
    const server = mod.default?.server;
    if (typeof server !== "function") throw new PhaseError("load");
    try {
      allHooks.push(await server.call(mod.default, input, entry.options));
    } catch {
      throw new PhaseError("server");
    }
    serverCalls += 1;
  }
  for (const hooks of allHooks) {
    if (typeof hooks?.config !== "function") continue;
    try {
      await hooks.config(config);
    } catch {
      throw new PhaseError("hook");
    }
    hookCalls += 1;
  }
  const result = {
    homedir: homedir(),
    configDir,
    entries: entries.map(({ source, spec, resolved }) => ({ source, spec, resolved })),
    serverCalls,
    hookCalls,
    initialConfig,
    config,
    logs,
  };
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
  process.stdout.write("kilo-start-simulator: ok\n");
}

try {
  await run(parseArgs(process.argv.slice(2)));
} catch (err) {
  if (err instanceof PhaseError) {
    process.stderr.write(`kilo-start-simulator: error: ${err.phase}\n`);
    process.exitCode = 1;
  } else {
    const reason = err instanceof Misuse ? err.message : "unexpected failure";
    process.stderr.write(`kilo-start-simulator: error: ${reason}\n`);
    process.exitCode = 2;
  }
}
