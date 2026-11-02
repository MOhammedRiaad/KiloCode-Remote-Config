// Test-only helpers for the install.ps1 tests (ADR-0014 section 11). Hermetic: from-scratch environment,
// temp profile, stub node/az, F-019 fake-network preload; never the real az, network or home.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { backendRoot, fakeNetworkUrl, findBash, isWindows, REQUIRED_ARGS, runInstall, withSandbox } from "./helpers.ts";
import type { RunInstallOptions, RunResult, Sandbox } from "./helpers.ts";

export const PS_SKIP = "PowerShell (pwsh or powershell.exe) not found: install.ps1 tests skipped";
export const installPs1Path = join(backendRoot, "installer", "install.ps1");
export const helperPath = join(backendRoot, "installer", "install-helper.ts");

export interface PsHost {
  label: string;
  path: string;
}

export interface PsSandbox extends Sandbox {
  state: string;
}

export interface PsRunResult extends RunResult {
  rawStdout: string;
  rawStderr: string;
}

export interface PsRunOptions {
  smoke?: boolean;
  scenario?: RunInstallOptions["scenario"];
  /** Alternative location of install.ps1 (used to test a script without its helper). */
  script?: string;
}

export function findPowerShellHosts(): { primary?: PsHost; extra: PsHost[] } {
  const override = process.env["KILO_TEST_PWSH"];
  if (override) return { primary: { label: "override", path: override }, extra: [] };
  let pwsh: PsHost | undefined;
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    for (const exe of ["pwsh.exe", "pwsh"]) {
      const candidate = join(dir, exe);
      if (pwsh === undefined && existsSync(candidate)) pwsh = { label: "pwsh", path: candidate };
    }
  }
  let legacy: PsHost | undefined;
  if (isWindows) {
    const root = process.env["SystemRoot"] ?? process.env["SYSTEMROOT"] ?? "C:\\Windows";
    const candidate = join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (existsSync(candidate)) legacy = { label: "powershell5", path: candidate };
  }
  if (pwsh !== undefined) return legacy === undefined ? { primary: pwsh, extra: [] } : { primary: pwsh, extra: [legacy] };
  return legacy === undefined ? { extra: [] } : { primary: legacy, extra: [] };
}

export const psHosts = findPowerShellHosts();
if (psHosts.primary === undefined) console.log(PS_SKIP);

/** Registers a test on the primary host and, when `parity` is set, on every extra host (Windows PowerShell 5.1). */
export function psTest(name: string, fn: (host: PsHost) => void, parity = false): void {
  if (psHosts.primary === undefined) {
    test(name, { skip: PS_SKIP }, () => {});
    return;
  }
  const hosts = parity ? [psHosts.primary, ...psHosts.extra] : [psHosts.primary];
  for (const host of hosts) test(`${name} [${host.label}]`, () => fn(host));
}

const forwardSlashes = (path: string) => path.replaceAll("\\", "/");

export function withPsSandbox(fn: (sb: PsSandbox) => void): void {
  const root = mkdtempSync(join(tmpdir(), "kilo-ps-"));
  const sb: PsSandbox = {
    root,
    home: join(root, "home"),
    bin: join(root, "bin"),
    xdg: join(root, "xdg"),
    state: join(root, "ps-state"),
    configDir: join(root, "home", ".config", "kilo"),
  };
  for (const dir of [sb.home, sb.bin, sb.xdg, sb.state, join(root, "t")]) mkdirSync(dir, { recursive: true });
  stubNodePs(sb);
  try {
    fn(sb);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writePosixStub(path: string, lines: string[]): void {
  writeFileSync(path, ["#!/bin/sh", ...lines, ""].join("\n"));
  chmodSync(path, 0o755);
}

export function stubNodePs(sb: PsSandbox, reportedVersion?: string): void {
  const real = process.execPath;
  if (isWindows) {
    const lines = ["@echo off", `>>"${join(sb.root, "node-argv.log")}" echo(%*`];
    if (reportedVersion !== undefined) lines.push('if "%~1"=="-p" (', `  echo ${reportedVersion}`, "  exit /b 0", ")");
    lines.push(`"${real}" %*`, "");
    writeFileSync(join(sb.bin, "node.cmd"), lines.join("\r\n"));
    return;
  }
  const lines = [`printf '%s\\n' "$*" >> "${forwardSlashes(join(sb.root, "node-argv.log"))}"`];
  if (reportedVersion !== undefined) lines.push(`if [ "$1" = "-p" ]; then echo ${reportedVersion}; exit 0; fi`);
  lines.push(`exec "${real}" "$@"`);
  writePosixStub(join(sb.bin, "node"), lines);
}

export function stubAzPs(sb: PsSandbox, mode: "ok" | "fail", token?: string): void {
  const code = mode === "ok" ? 0 : 1;
  if (isWindows) {
    const tokenAction = token !== undefined ? `echo(${token}\r\n  exit /b 0` : "exit /b 1";
    writeFileSync(
      join(sb.bin, "az.cmd"),
      [
        "@echo off",
        `>>"${join(sb.root, "az.log")}" echo(%*`,
        `if "%~1 %~2"=="account show" exit /b ${code}`,
        'if "%~1 %~2"=="account get-access-token" (',
        `  ${tokenAction}`,
        ")",
        "exit /b 0",
        "",
      ].join("\r\n"),
    );
    return;
  }
  const tokenAction = token !== undefined ? `printf '%s\\n' '${token}'\n  exit 0` : "exit 1";
  writePosixStub(join(sb.bin, "az"), [
    `printf '%s\\n' "$*" >> "${forwardSlashes(join(sb.root, "az.log"))}"`,
    `if [ "$1 $2" = "account show" ]; then exit ${code}; fi`,
    'if [ "$1 $2" = "account get-access-token" ]; then',
    `  ${tokenAction}`,
    "fi",
    "exit 0",
  ]);
}

export function removeNodeStub(sb: PsSandbox): void {
  rmSync(join(sb.bin, isWindows ? "node.cmd" : "node"), { force: true });
}

const normalise = (text: string) => text.replaceAll("\r\n", "\n");

function psEnv(sb: PsSandbox, netJsonPath: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: sb.bin,
    HOME: sb.home,
    XDG_CACHE_HOME: join(sb.state, "cache"),
    XDG_DATA_HOME: join(sb.state, "data"),
    POWERSHELL_TELEMETRY_OPTOUT: "1",
    POWERSHELL_UPDATECHECK: "Off",
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    NODE_OPTIONS: `--import=${fakeNetworkUrl}`,
    KILO_TEST_FAKE_NET: netJsonPath,
  };
  if (isWindows) {
    const temp = join(sb.root, "t");
    const systemRoot = process.env["SYSTEMROOT"] ?? "C:\\Windows";
    Object.assign(env, {
      USERPROFILE: sb.home,
      SYSTEMROOT: systemRoot,
      WINDIR: process.env["WINDIR"] ?? systemRoot,
      ComSpec: process.env["ComSpec"] ?? join(systemRoot, "System32", "cmd.exe"),
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
      TEMP: temp,
      TMP: temp,
      LOCALAPPDATA: join(sb.state, "local"),
      APPDATA: join(sb.state, "roaming"),
    });
  }
  return env;
}

export function runInstallPs(
  sb: PsSandbox,
  host: PsHost,
  args: string[],
  extraEnv: Record<string, string> = {},
  opts: PsRunOptions = {},
): PsRunResult {
  const netLogPath = join(sb.root, "net.log");
  const netJsonPath = join(sb.root, "net.json");
  rmSync(netLogPath, { force: true });
  writeFileSync(netJsonPath, JSON.stringify({ log: netLogPath, ...(opts.scenario ?? {}) }));
  const scriptArgs = opts.smoke ? args : ["-NoSmoke", ...args];
  const result = spawnSync(
    host.path,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", opts.script ?? installPs1Path, ...scriptArgs],
    { env: { ...psEnv(sb, netJsonPath), ...extraEnv }, encoding: "utf8", timeout: 60000 },
  );
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: normalise(result.stdout),
    stderr: normalise(result.stderr),
    rawStdout: result.stdout,
    rawStderr: result.stderr,
  };
}

/** The installer must not have created its config dir; PowerShell's own host state is allowed. */
export function assertNoInstallerFootprint(sb: PsSandbox): void {
  if (existsSync(join(sb.home, ".config", "kilo"))) throw new Error("installer footprint: .config/kilo exists");
  const dotConfig = join(sb.home, ".config");
  if (existsSync(dotConfig)) {
    const extra = readdirSync(dotConfig).filter((name) => name !== "powershell");
    if (extra.length > 0) throw new Error(`installer footprint: .config holds ${extra.join(", ")}`);
  }
}

/**
 * True for the only two node invocations install.ps1 may make: the version probe and the helper.
 * The Windows cmd stub logs `%*` (quotes kept); the POSIX stub logs `$*` (quotes consumed by the shell).
 */
export function isAllowedNodeArgv(line: string): boolean {
  const expected = isWindows ? `"${helperPath}"` : helperPath;
  return line === "-p process.versions.node" || line.toLowerCase() === expected.toLowerCase();
}

export function readLog(sb: PsSandbox, name: "node-argv.log" | "az.log"): string[] {
  const path = join(sb.root, name);
  if (!existsSync(path)) return [];
  return normalise(readFileSync(path, "utf8"))
    .split("\n")
    .filter((line) => line !== "");
}

/**
 * Personal-config bytes that install.sh would write for the same inputs: runs install.sh in a second
 * sandbox, or the helper directly (no `frontend` record) when bash is not available. Returns the file
 * bytes of `<configDir>/kilo.jsonc` after the run; `seed` pre-populates the config.
 */
export function referenceConfig(
  seed: string | undefined,
  env: Record<string, string>,
  args: string[] = REQUIRED_ARGS,
): Buffer {
  let result: Buffer | undefined;
  withSandbox((sb) => {
    if (seed !== undefined) {
      mkdirSync(sb.configDir, { recursive: true });
      writeFileSync(join(sb.configDir, "kilo.jsonc"), seed);
    }
    let bash = true;
    try {
      findBash();
    } catch {
      bash = false;
    }
    const r = bash ? runInstall(sb, args, env) : runHelperDirect(sb, args, env);
    if (r.status !== 0) throw new Error(`reference install failed: ${r.stderr}`);
    result = readFileSync(join(sb.configDir, "kilo.jsonc"));
  });
  return result as unknown as Buffer;
}

function runHelperDirect(sb: Sandbox, args: string[], env: Record<string, string>): RunResult {
  const flag = (name: string, fallback: string) => {
    const at = args.indexOf(name);
    return at === -1 ? fallback : (args[at + 1] ?? fallback);
  };
  const records = [
    ["org", flag("--org", "")],
    ["project", flag("--project", "")],
    ["repo", flag("--repo", "")],
    ["path", flag("--path", "/kilo.jsonc")],
    ["branch", flag("--branch", "main")],
    ["mode", flag("--mode", "defaults")],
    ["apiKey", env["KILO_BIFROST_KEY"] ?? ""],
    ["smoke", "off"],
  ];
  const input = records.map(([name, value]) => `${name}=${value}\0`).join("");
  const childEnv: Record<string, string> = { HOME: sb.home, USERPROFILE: sb.home };
  if (isWindows) childEnv["SYSTEMROOT"] = process.env["SYSTEMROOT"] ?? "C:\\Windows";
  const r = spawnSync(process.execPath, [helperPath], { input, env: childEnv, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
