import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FakeAnswer, FakeScenario, FakeStaticAnswer } from "./fixtures/fake-network.ts";

export type { FakeAnswer, FakeScenario, FakeStaticAnswer };

export const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const installShPath = join(backendRoot, "installer", "install.sh").replaceAll("\\", "/");
export const fakeNetworkUrl = pathToFileURL(
  join(backendRoot, "test", "installer", "fixtures", "fake-network.ts"),
).href;
export const raceFixtureUrl = pathToFileURL(
  join(backendRoot, "test", "installer", "fixtures", "race-after-mkdir.ts"),
).href;
export const isWindows = process.platform === "win32";
export const REQUIRED_ARGS = ["--org", "acme", "--project", "proj", "--repo", "cfg"];

export interface Sandbox {
  root: string;
  home: string;
  bin: string;
  xdg: string;
  configDir: string;
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface RunInstallOptions {
  smoke?: boolean;
  scenario?: FakeScenario;
  cwd?: string;
  script?: string;
  preload?: string[];
}

export type NetLogRequest = {
  event: "request";
  url: string;
  method: string;
  headers: Record<string, string>;
  redirect: string;
};

export type NetLogEntry = { event: "loaded" } | NetLogRequest;

export function findBash(): string {
  const override = process.env["KILO_TEST_BASH"];
  if (override) return override;
  const exe = isWindows ? "bash.exe" : "bash";
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    const lower = dir.toLowerCase();
    if (dir === "" || lower.includes("\\windows\\system32") || lower.includes("windowsapps")) continue;
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("bash was not found on PATH (set KILO_TEST_BASH)");
}

const forwardSlashes = (path: string) => path.replaceAll("\\", "/");

function writeExecutable(path: string, text: string): void {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

export function stubNode(sb: Sandbox, reportedVersion?: string, opts: { log?: boolean } = {}): void {
  const real = forwardSlashes(process.execPath);
  const logLine = opts.log ? `printf '%s\\n' "$*" >> "${forwardSlashes(join(sb.root, "node.log"))}"\n` : "";
  const body =
    reportedVersion === undefined
      ? `exec "${real}" "$@"\n`
      : `if [ "$1" = "-p" ]; then echo ${reportedVersion}; exit 0; fi\nexec "${real}" "$@"\n`;
  writeExecutable(join(sb.bin, "node"), `#!/bin/sh\n${logLine}${body}`);
}

export function stubAz(sb: Sandbox, mode: "ok" | "fail", token?: string): void {
  const log = forwardSlashes(join(sb.root, "az.log"));
  const code = mode === "ok" ? 0 : 1;
  const tokenAction = token !== undefined ? `printf '%s\\n' '${token}'\n  exit 0` : "exit 1";
  writeExecutable(
    join(sb.bin, "az"),
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> "${log}"`,
      `if [ "$1 $2" = "account show" ]; then exit ${code}; fi`,
      'if [ "$1 $2" = "account get-access-token" ]; then',
      `  ${tokenAction}`,
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  if (isWindows) {
    const winLog = join(sb.root, "az.log");
    const winTokenAction = token !== undefined ? `echo(${token}\r\n  exit /b 0` : "exit /b 1";
    writeFileSync(
      join(sb.bin, "az.cmd"),
      [
        "@echo off",
        `>>"${winLog}" echo(%*`,
        `if "%~1 %~2"=="account show" exit /b ${code}`,
        'if "%~1 %~2"=="account get-access-token" (',
        `  ${winTokenAction}`,
        ")",
        "exit /b 0",
        "",
      ].join("\r\n"),
    );
  }
}

export function azLogExists(sb: Sandbox): boolean {
  return existsSync(join(sb.root, "az.log"));
}

export function readAzLog(sb: Sandbox): string[] {
  const path = join(sb.root, "az.log");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => line !== "");
}

export function readNetLog(sb: Sandbox): NetLogEntry[] {
  const path = join(sb.root, "net.log");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as NetLogEntry);
}

export function requests(sb: Sandbox): NetLogRequest[] {
  return readNetLog(sb).filter((entry): entry is NetLogRequest => entry.event === "request");
}

export function expectedItemsUrl(org: string, project: string, repo: string, path: string, branch: string): string {
  const e = encodeURIComponent;
  return (
    `https://dev.azure.com/${e(org)}/${e(project)}/_apis/git/repositories/${e(repo)}/items` +
    `?path=${e(path)}&versionDescriptor.version=${e(branch)}&versionDescriptor.versionType=branch` +
    "&includeContent=true&api-version=7.1"
  );
}

export function withSandbox(fn: (sb: Sandbox) => void): void {
  const root = mkdtempSync(join(tmpdir(), "kilo-inst-"));
  const sb: Sandbox = {
    root,
    home: join(root, "home"),
    bin: join(root, "bin"),
    xdg: join(root, "xdg"),
    configDir: join(root, "home", ".config", "kilo"),
  };
  for (const dir of [sb.home, sb.bin, sb.xdg, join(root, "t")]) mkdirSync(dir, { recursive: true });
  stubNode(sb);
  try {
    fn(sb);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function runInstall(
  sb: Sandbox,
  args: string[],
  extraEnv: Record<string, string> = {},
  opts: RunInstallOptions = {},
): RunResult {
  const netLogPath = join(sb.root, "net.log");
  const netJsonPath = join(sb.root, "net.json");
  rmSync(netLogPath, { force: true });
  writeFileSync(netJsonPath, JSON.stringify({ log: netLogPath, ...(opts.scenario ?? {}) }));

  const env: Record<string, string> = {
    PATH: sb.bin,
    HOME: sb.home,
    NODE_OPTIONS: [fakeNetworkUrl, ...(opts.preload ?? [])].map((url) => `--import=${url}`).join(" "),
    MSYS2_ENV_CONV_EXCL: "NODE_OPTIONS;KILO_TEST_FAKE_NET;KILO_TEST_RACE",
    KILO_TEST_FAKE_NET: netJsonPath,
  };
  if (isWindows) {
    const temp = join(sb.root, "t");
    Object.assign(env, {
      USERPROFILE: sb.home,
      SYSTEMROOT: process.env["SYSTEMROOT"] ?? "C:\\Windows",
      ComSpec: process.env["ComSpec"] ?? "C:\\Windows\\System32\\cmd.exe",
      TEMP: temp,
      TMP: temp,
    });
  }
  const script = opts.script ?? installShPath;
  const spawnArgs = opts.smoke ? [script, ...args] : [script, "--no-smoke", ...args];
  const result = spawnSync(findBash(), spawnArgs, {
    env: { ...env, ...extraEnv },
    encoding: "utf8",
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export type Snapshot = Record<string, string>;

export function snapshot(dir: string): Snapshot {
  const out: Snapshot = {};
  const walk = (current: string, prefix: string) => {
    if (!existsSync(current)) return;
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        out[`${prefix}${name}/`] = isWindows ? "dir" : `dir:${stat.mode & 0o777}`;
        walk(full, `${prefix}${name}/`);
      } else {
        const mode = isWindows ? "" : `:${stat.mode & 0o777}`;
        out[`${prefix}${name}`] = `${readFileSync(full).toString("hex")}${mode}`;
      }
    }
  };
  walk(dir, "");
  return out;
}

export function backups(configDir: string): string[] {
  return existsSync(configDir) ? readdirSync(configDir).filter((n) => n.startsWith("kilo.jsonc.bak-")) : [];
}
