import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { __internals } from "../../plugin/azdo-remote-config.ts";
import { backendRoot, fakeNetworkUrl, findBash, isWindows, stubAz, withSandbox } from "../installer/helpers.ts";
import type { FakeScenario, NetLogEntry, NetLogRequest, Sandbox } from "../installer/helpers.ts";

export const simulatorPath = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "kilo-start-simulator.ts");

function bashSkipReason(): string | false {
  try {
    findBash();
    return false;
  } catch {
    return "bash not found on PATH (set KILO_TEST_BASH): end-to-end startup suite skipped";
  }
}

export const BASH_SKIP: string | false = bashSkipReason();

export interface E2eSandbox extends Sandbox {
  work: string;
  cacheFile: string;
}

export interface SimResult {
  homedir: string;
  configDir: string;
  entries: { source: "config" | "auto"; spec: string; resolved: string }[];
  serverCalls: number;
  hookCalls: number;
  initialConfig: Record<string, unknown>;
  config: Record<string, unknown>;
  logs: unknown[];
}

export interface StartRun {
  status: number | null;
  stdout: string;
  stderr: string;
  result: SimResult | undefined;
  requests: NetLogRequest[];
  loaded: boolean;
}

export function withE2eSandbox(fn: (sb: E2eSandbox) => void): void {
  withSandbox((base) => {
    stubAz(base, "fail");
    const work = join(base.root, "work");
    mkdirSync(work, { recursive: true });
    fn({ ...base, work, cacheFile: join(base.home, ".cache", "kilo-azdo", "remote-config.json") });
  });
}

const startCounters = new WeakMap<object, number>();

function childEnv(sb: E2eSandbox, scenarioFile: string): Record<string, string> {
  const env: Record<string, string> = {
    HOME: sb.home,
    USERPROFILE: sb.home,
    PATH: sb.bin,
    KILO_TEST_FAKE_NET: scenarioFile,
  };
  if (isWindows) {
    const temp = join(sb.root, "t");
    Object.assign(env, {
      SYSTEMROOT: process.env["SYSTEMROOT"] ?? "C:\Windows",
      ComSpec: process.env["ComSpec"] ?? "C:\Windows\System32\cmd.exe",
      TEMP: temp,
      TMP: temp,
    });
  }
  return env;
}

function readNet(path: string): NetLogEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as NetLogEntry);
}

function writeScenario(sb: E2eSandbox, name: string, scenario: FakeScenario): { file: string; log: string } {
  const file = join(sb.root, `${name}.json`);
  const log = join(sb.root, `${name}.net.log`);
  writeFileSync(file, JSON.stringify({ log, ...scenario }));
  return { file, log };
}

export function runStart(sb: E2eSandbox, scenario: FakeScenario, env: { AZDO_PAT?: string } = {}): StartRun {
  const n = (startCounters.get(sb) ?? 0) + 1;
  startCounters.set(sb, n);
  const { file, log } = writeScenario(sb, `start-${n}`, scenario);
  const out = join(sb.root, `start-${n}.out.json`);
  const childEnvVars = childEnv(sb, file);
  if (env.AZDO_PAT !== undefined) childEnvVars["AZDO_PAT"] = env.AZDO_PAT;
  const r = spawnSync(process.execPath, ["--import=" + fakeNetworkUrl, simulatorPath, "--out", out], {
    cwd: sb.work,
    env: childEnvVars,
    encoding: "utf8",
    timeout: 30000,
  });
  if (r.error) throw r.error;
  const entries = readNet(log);
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    result: existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as SimResult) : undefined,
    requests: entries.filter((e): e is NetLogRequest => e.event === "request"),
    loaded: entries.some((e) => e.event === "loaded"),
  };
}

export function probeFetch(
  sb: E2eSandbox,
  scenario: FakeScenario,
  url: string,
): { status: number | null; stdout: string; stderr: string } {
  const n = (startCounters.get(sb) ?? 0) + 1;
  startCounters.set(sb, n);
  const { file } = writeScenario(sb, `probe-${n}`, scenario);
  const r = spawnSync(
    process.execPath,
    [
      "--import=" + fakeNetworkUrl,
      "--input-type=module",
      "-e",
      "const r = await fetch(process.argv[1]); process.stdout.write(String(r.status));",
      url,
    ],
    { cwd: sb.work, env: childEnv(sb, file), encoding: "utf8", timeout: 30000 },
  );
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function assertNoLeaks(label: string, text: string, secrets: readonly string[]): void {
  secrets.forEach((secret, index) => {
    assert.equal(text.includes(secret), false, `${label}: leaked secret #${index}`);
  });
}

export function sharedConfigText(): string {
  return readFileSync(join(backendRoot, "shared-config", "kilo.jsonc"), "utf8");
}

export function parseShared(): Record<string, unknown> {
  return __internals.parseJsonc(sharedConfigText()) as Record<string, unknown>;
}

function stripApiKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripApiKeys);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (k !== "apiKey") out[k] = stripApiKeys(v);
    return out;
  }
  return value;
}

export function expectedCache(shared: Record<string, unknown>): Record<string, unknown> {
  const copy = stripApiKeys(structuredClone(shared)) as Record<string, unknown>;
  delete copy["$schema"];
  delete copy["plugin"];
  return copy;
}
