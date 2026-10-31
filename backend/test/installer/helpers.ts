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
import { fileURLToPath } from "node:url";

export const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const installShPath = join(backendRoot, "installer", "install.sh").replaceAll("\\", "/");
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

export function stubNode(sb: Sandbox, reportedVersion?: string): void {
  const real = forwardSlashes(process.execPath);
  const body =
    reportedVersion === undefined
      ? `exec "${real}" "$@"\n`
      : `if [ "$1" = "-p" ]; then echo ${reportedVersion}; exit 0; fi\nexec "${real}" "$@"\n`;
  writeExecutable(join(sb.bin, "node"), `#!/bin/sh\n${body}`);
}

export function stubAz(sb: Sandbox, mode: "ok" | "fail"): void {
  const log = forwardSlashes(join(sb.root, "az.log"));
  const code = mode === "ok" ? 0 : 1;
  writeExecutable(
    join(sb.bin, "az"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nif [ "$1 $2" = "account show" ]; then exit ${code}; fi\nexit 0\n`,
  );
}

export function azLogExists(sb: Sandbox): boolean {
  return existsSync(join(sb.root, "az.log"));
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

export function runInstall(sb: Sandbox, args: string[], extraEnv: Record<string, string> = {}): RunResult {
  const env: Record<string, string> = { PATH: sb.bin, HOME: sb.home };
  if (isWindows) {
    const temp = join(sb.root, "t");
    Object.assign(env, {
      USERPROFILE: sb.home,
      SYSTEMROOT: process.env["SYSTEMROOT"] ?? "C:\\Windows",
      TEMP: temp,
      TMP: temp,
    });
  }
  const result = spawnSync(findBash(), [installShPath, ...args], { env: { ...env, ...extraEnv }, encoding: "utf8" });
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
