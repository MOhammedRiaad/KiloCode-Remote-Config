import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const cliPath = join(backendRoot, "validator", "validate-kilo-config.ts");
export const examplePath = join(backendRoot, "shared-config", "kilo.jsonc");

// Built at runtime so the repo never contains a secret-shaped literal.
export const FAKE_SECRET = "sk-" + "bf-" + "AbCdEf" + "1234567890";
export const SECRET_TAIL = "AbCdEf1234567890";
export const SENTINEL = "VALUE_SENTINEL_42";

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
  all: string;
}

export function runCli(args: string[], cwd?: string): CliResult {
  const r = spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8", cwd });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, all: r.stdout + r.stderr };
}

/** Writes each named file into a fresh temp dir, runs fn, and always cleans up. */
export function withFiles<T>(files: Record<string, string | Buffer>, fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "kilo-val-"));
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs the CLI on a single file with the given content. */
export function runOn(content: string | Buffer, extraArgs: string[] = []): CliResult {
  return withFiles({ "c.jsonc": content }, (dir) => runCli([...extraArgs, join(dir, "c.jsonc")]));
}

export function noStack(r: CliResult): boolean {
  return !/\n\s+at /.test(r.all);
}
