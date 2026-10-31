import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findBash } from "../installer/helpers.ts";

export const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const sharedConfigDir = join(backendRoot, "shared-config");
export const assembleTool = join(backendRoot, "tools", "assemble-shared-repo.ts");
export const policyScript = join(sharedConfigDir, "set-branch-policies.sh");
export const isWindows = process.platform === "win32";

export const GUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
export const PAT_SENTINEL = "PAT_SENTINEL_9f3";
export const VALUE_SENTINEL = "VALUE_SENTINEL_42";

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export const forwardSlashes = (path: string): string => path.replaceAll("\\", "/");

export function withTmp(fn: (tmp: string) => void): void {
  const tmp = mkdtempSync(join(tmpdir(), "kilo-c1-"));
  try {
    fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function runAssemble(args: string[], cwd?: string): RunResult {
  const r = spawnSync(process.execPath, [assembleTool, ...args], { encoding: "utf8", ...(cwd ? { cwd } : {}) });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function assembleTree(tmp: string): string {
  const outdir = join(tmp, "c1");
  const r = runAssemble([outdir]);
  if (r.status !== 0) throw new Error(`assemble failed: ${r.stderr}`);
  return outdir;
}

export function yamlScriptLines(yamlText: string): string[] {
  const lines = yamlText.split("\n");
  const start = lines.indexOf("  - bash: |");
  if (start === -1 || lines.lastIndexOf("  - bash: |") !== start) throw new Error("expected exactly one bash step");
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const indent = line.length - line.trimStart().length;
    if (line.trim() !== "" && indent < 6) break;
    out.push(line.slice(6));
  }
  return out;
}

export function extractPipelineScript(yamlText: string): string {
  return yamlScriptLines(yamlText).join("\n").trimEnd() + "\n";
}

export function defaultAllowedHosts(yamlText: string): string {
  const matches = yamlText.split("\n").flatMap((line) => {
    const m = /^ {2}KILO_ALLOWED_HOSTS: ([a-z0-9.,-]+)$/.exec(line);
    return m && m[1] !== undefined ? [m[1]] : [];
  });
  if (matches.length !== 1 || matches[0] === undefined) throw new Error("expected one KILO_ALLOWED_HOSTS default");
  return matches[0];
}

function writeExecutable(path: string, text: string): void {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

export function makeBin(tmp: string, opts: { node?: boolean; az?: boolean } = {}): string {
  const bin = join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  if (opts.node) writeExecutable(join(bin, "node"), `#!/bin/sh\nexec "${forwardSlashes(process.execPath)}" "$@"\n`);
  if (opts.az) {
    const log = forwardSlashes(join(tmp, "az.log"));
    writeExecutable(
      join(bin, "az"),
      [
        "#!/bin/sh",
        `printf '%s\\0' "$@" >> "${log}"`,
        `printf '\\n' >> "${log}"`,
        'echo "AZ_STDOUT_MARKER $AZURE_DEVOPS_EXT_PAT"',
        'echo "AZ_STDERR_MARKER" >&2',
        'if [ "$3" = "${FAKE_AZ_FAIL:-}" ]; then exit 7; fi',
        "exit 0",
        "",
      ].join("\n"),
    );
  }
  return bin;
}

export function sandboxEnv(tmp: string, bin: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { PATH: bin, HOME: join(tmp, "home") };
  if (isWindows) {
    Object.assign(env, {
      SYSTEMROOT: process.env["SYSTEMROOT"] ?? "C:\\Windows",
      ComSpec: process.env["ComSpec"] ?? "C:\\Windows\\System32\\cmd.exe",
      TEMP: tmp,
      TMP: tmp,
    });
  }
  return { ...env, ...extra };
}

export function runBash(script: string, args: string[], cwd: string, env: Record<string, string>): RunResult {
  const r = spawnSync(findBash(), ["--noprofile", "--norc", forwardSlashes(script), ...args], {
    cwd,
    env,
    encoding: "utf8",
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function readAzRecords(tmp: string): string[][] {
  const path = join(tmp, "az.log");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.split("\0").slice(0, -1));
}

export function shQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

export interface PolicyInputs {
  org: string;
  project: string;
  repo: string;
  group: string;
  build: string;
}

export const VALID: PolicyInputs = {
  org: "acme",
  project: "Kilo Platform",
  repo: GUID,
  group: "11111111-2222-4333-8444-555555555555",
  build: "42",
};

export function policyArgs(inputs: PolicyInputs = VALID, extra: string[] = []): string[] {
  return [
    "--org", inputs.org,
    "--project", inputs.project,
    "--repository-id", inputs.repo,
    "--reviewer-group", inputs.group,
    "--build-definition-id", inputs.build,
    ...extra,
  ];
}

export function expectedArgv(inputs: PolicyInputs, orgUrl: string): string[][] {
  const common = [
    "--org", orgUrl, "--project", inputs.project, "--repository-id", inputs.repo,
    "--branch", "main", "--branch-match-type", "exact", "--enabled", "true", "--blocking", "true",
  ];
  return [
    [
      "repos", "policy", "approver-count", "create", ...common,
      "--minimum-approver-count", "1", "--creator-vote-counts", "false", "--allow-downvotes", "false",
      "--reset-on-source-push", "true", "--output", "none",
    ],
    [
      "repos", "policy", "required-reviewer", "create", ...common,
      "--required-reviewer-ids", inputs.group,
      "--message", "Platform team review is required for shared Kilo config changes.", "--output", "none",
    ],
    [
      "repos", "policy", "build", "create", ...common,
      "--build-definition-id", inputs.build, "--display-name", "kilo-config PR validation",
      "--manual-queue-only", "false", "--queue-on-source-update-only", "false", "--valid-duration", "0",
      "--output", "none",
    ],
  ];
}
