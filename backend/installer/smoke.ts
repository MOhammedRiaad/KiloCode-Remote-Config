// Smoke checks for the bootstrap installer (ADR-0013, contract installer-cli.md section 9).
// Verifies Azure DevOps shared-config fetch and Bifrost /models reachability without writing files
// or exposing secrets, response bodies or underlying error text.
import { __internals } from "../plugin/azdo-remote-config.ts";
import { isPlainObject, PLACEHOLDER_KEY } from "./personal-config-edit.ts";
import type { Values } from "./personal-config-edit.ts";

export const SMOKE_ENV_NAMES = ["AZDO_PAT", "AZURE_DEVOPS_EXT_PAT", "KILO_AZDO_PAT", "KILO_AZDO_TIMEOUT_MS"] as const;

export type SmokeOutcome =
  | { status: "pass" }
  | { status: "fail"; code: string }
  | { status: "skipped"; code: "azdo-failed" | "no-key" | "key-reference" };

export interface SmokeReport {
  azdo: SmokeOutcome;
  bifrost: SmokeOutcome;
}

export interface SmokeDeps {
  env: Readonly<Record<string, string | undefined>>;
  fetch?: (
    url: string,
    init: { method: "GET"; headers: Record<string, string>; redirect: "manual"; signal: AbortSignal },
  ) => Promise<unknown>;
  runAz?: unknown;
  setTimeout?: unknown;
  clearTimeout?: unknown;
}

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_KEY_CHARS = 4096;
const MAX_RESPONSE_BYTES = 1048576;
const MAX_EMPTY_CHUNKS = 1024;
const FORWARDED_DEP_KEYS = ["fetch", "runAz", "setTimeout", "clearTimeout"] as const;
export type FrontEnd = "install.sh" | "install.ps1";

type BifrostFetchCode = "timeout" | "too-large" | "bad-response" | "network";
type Outcome = { state: "value"; value: unknown } | { state: "failed" } | { state: "deadline" };

interface Clock {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

interface Deadline {
  race: (op: () => unknown) => Promise<Outcome>;
  timedOut: () => boolean;
}

interface BodyReader {
  read: () => unknown;
  cancel: () => unknown;
}

interface AzdoCheckResult {
  outcome: SmokeOutcome;
  shared?: Record<string, unknown>;
  timeoutMs: number;
}

function noop(): void {}

function attempt<T>(probe: () => T): T | undefined {
  try {
    return probe();
  } catch {
    return undefined;
  }
}

function readOwn(source: unknown, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function ownPlainProperty(source: unknown, key: string): unknown {
  if (!isPlainObject(source) || !Object.hasOwn(source, key)) return undefined;
  return readOwn(source, key);
}

function readSharedBaseUrl(shared: Record<string, unknown>): unknown {
  const provider = ownPlainProperty(shared, "provider");
  const bifrost = ownPlainProperty(provider, "bifrost");
  const options = ownPlainProperty(bifrost, "options");
  return ownPlainProperty(options, "baseURL");
}

function isVisibleAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
}

function isDigitString(text: string): boolean {
  if (text === "") return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x30 || code > 0x39) return false;
  }
  return true;
}

/** Copies only the allow-listed smoke environment variables whose own values are strings. */
export function pickSmokeEnv(source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of SMOKE_ENV_NAMES) {
    const value = readOwn(source, name);
    if (typeof value === "string") out[name] = value;
  }
  return out;
}

/** Validates the shared Bifrost baseURL (https only, no userinfo/query/fragment) and builds <baseURL>/models. */
export function modelsUrl(
  baseURL: unknown,
): { ok: true; url: string } | { ok: false; code: "no-base-url" | "invalid-base-url" | "insecure-base-url" } {
  if (typeof baseURL !== "string") return { ok: false, code: "no-base-url" };
  const trimmed = baseURL.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, code: "invalid-base-url" };
  }
  const authority = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/]*)/.exec(trimmed)?.[1];
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    trimmed.includes("?") ||
    trimmed.includes("#") ||
    (authority !== undefined && authority.includes("@"))
  ) {
    return { ok: false, code: "invalid-base-url" };
  }
  if (parsed.protocol !== "https:") return { ok: false, code: "insecure-base-url" };
  if (!/^https:\/\//i.test(trimmed) || parsed.host === "") return { ok: false, code: "invalid-base-url" };
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/models`;
  return { ok: true, url: parsed.toString() };
}

/** Classifies the effective personal-config apiKey before any Bifrost request is sent. */
export function classifyKey(key: unknown): { ok: true; key: string } | { ok: false; outcome: SmokeOutcome } {
  if (typeof key !== "string" || key === "" || key === PLACEHOLDER_KEY) {
    return { ok: false, outcome: { status: "skipped", code: "no-key" } };
  }
  if (key.includes("{env:") || key.includes("{file:")) {
    return { ok: false, outcome: { status: "skipped", code: "key-reference" } };
  }
  if (key.length > MAX_KEY_CHARS || !isVisibleAscii(key)) {
    return { ok: false, outcome: { status: "fail", code: "invalid-key" } };
  }
  return { ok: true, key };
}

function resolveClock(deps: unknown): Clock {
  const set = readOwn(deps, "setTimeout");
  const clear = readOwn(deps, "clearTimeout");
  return {
    set: (typeof set === "function" ? set : globalThis.setTimeout) as Clock["set"],
    clear: (typeof clear === "function" ? clear : globalThis.clearTimeout) as Clock["clear"],
  };
}

function startDeadline(
  clock: Clock,
  controller: AbortController,
  timeoutMs: number,
): { deadline: Deadline; handle: unknown } {
  let fired = false;
  let fire: () => void = noop;
  const expired = new Promise<Outcome>((resolve) => {
    fire = () => resolve({ state: "deadline" });
  });
  const handle = clock.set(() => {
    fired = true;
    attempt(() => controller.abort());
    fire();
  }, timeoutMs);
  const settle = (op: () => unknown): Promise<Outcome> =>
    new Promise<unknown>((resolve) => resolve(op())).then(
      (value): Outcome => {
        if (fired) discardBody(value);
        return { state: "value", value };
      },
      (): Outcome => ({ state: "failed" }),
    );
  return {
    deadline: { race: (op) => Promise.race([settle(op), expired]), timedOut: () => fired },
    handle,
  };
}

function codeForInterrupted(outcome: Outcome, deadline: Deadline): BifrostFetchCode {
  return outcome.state === "deadline" || deadline.timedOut() ? "timeout" : "network";
}

function discard(cancel: () => unknown): void {
  attempt(() => {
    Promise.resolve(cancel()).catch(noop);
  });
}

function discardBody(response: unknown): void {
  discard(() => (response as { body: { cancel: () => unknown } }).body.cancel());
}

function declaredTooLarge(response: unknown): boolean {
  const raw = attempt(() =>
    (response as { headers: { get: (name: string) => unknown } }).headers.get("content-length"),
  );
  if (typeof raw !== "string") return false;
  const header = raw.trim();
  return isDigitString(header) && Number(header) > MAX_RESPONSE_BYTES;
}

function readStatus(response: unknown): number | undefined {
  const status = attempt(() => (response as { status: unknown }).status);
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

function openReader(response: unknown): BodyReader | undefined {
  const reader = attempt(() => (response as { body: { getReader: () => BodyReader } }).body.getReader());
  const usable = attempt(() => typeof reader?.read === "function" && typeof reader.cancel === "function");
  return usable === true ? reader : undefined;
}

function joinChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readCappedBody(response: unknown, deadline: Deadline): Promise<Uint8Array | BifrostFetchCode> {
  const reader = openReader(response);
  if (reader === undefined) {
    discardBody(response);
    return "bad-response";
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let empty = 0;
  for (;;) {
    const outcome = await deadline.race(() => reader.read());
    if (outcome.state !== "value") {
      discard(() => reader.cancel());
      return codeForInterrupted(outcome, deadline);
    }
    const step = outcome.value as { done?: unknown; value?: unknown } | null;
    if (attempt(() => step?.done) === true) return joinChunks(chunks, total);
    const chunk = attempt(() => step?.value);
    if (!(chunk instanceof Uint8Array)) {
      discard(() => reader.cancel());
      return "bad-response";
    }
    total += chunk.byteLength;
    empty = chunk.byteLength === 0 ? empty + 1 : 0;
    if (total > MAX_RESPONSE_BYTES || empty > MAX_EMPTY_CHUNKS) {
      discard(() => reader.cancel());
      return total > MAX_RESPONSE_BYTES ? "too-large" : "bad-response";
    }
    chunks.push(chunk);
  }
}

function isJsonObjectBytes(bytes: Uint8Array): boolean {
  const text = attempt(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (text === undefined) return false;
  const parsed = attempt(() => JSON.parse(text) as unknown);
  return isPlainObject(parsed);
}

async function checkAzdo(values: Values, env: Record<string, string>, deps: SmokeDeps): Promise<AzdoCheckResult> {
  try {
    const { settings } = __internals.resolveSettings(values, { env });
    const timeoutMs =
      typeof settings.timeoutMs === "number" && Number.isInteger(settings.timeoutMs) && settings.timeoutMs >= 1
        ? settings.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    const azdoDeps: Record<string, unknown> = { env };
    for (const key of FORWARDED_DEP_KEYS) {
      const val = readOwn(deps, key);
      if (val !== undefined) azdoDeps[key] = val;
    }
    const fetched = await __internals.fetchRemoteConfig(settings, azdoDeps);
    if (!fetched.ok) return { outcome: { status: "fail", code: fetched.error }, timeoutMs };
    let parsed: unknown;
    try {
      parsed = __internals.parseJsonc(fetched.text);
    } catch {
      return { outcome: { status: "fail", code: "invalid-jsonc" }, timeoutMs };
    }
    if (!isPlainObject(parsed)) return { outcome: { status: "fail", code: "invalid-shape" }, timeoutMs };
    return { outcome: { status: "pass" }, shared: parsed, timeoutMs };
  } catch {
    return { outcome: { status: "fail", code: "internal" }, timeoutMs: DEFAULT_TIMEOUT_MS };
  }
}

async function checkBifrost(azdo: AzdoCheckResult, apiKey: unknown, deps: SmokeDeps): Promise<SmokeOutcome> {
  try {
    if (azdo.outcome.status !== "pass" || azdo.shared === undefined) {
      return { status: "skipped", code: "azdo-failed" };
    }
    const urlCheck = modelsUrl(readSharedBaseUrl(azdo.shared));
    if (!urlCheck.ok) return { status: "fail", code: urlCheck.code };
    const keyCheck = classifyKey(apiKey);
    if (!keyCheck.ok) return keyCheck.outcome;

    const injectedFetch = readOwn(deps, "fetch");
    const candidateFetch = injectedFetch === undefined ? globalThis.fetch : injectedFetch;
    if (typeof candidateFetch !== "function") return { status: "fail", code: "network" };
    const fetchFn = candidateFetch as NonNullable<SmokeDeps["fetch"]>;

    const clock = resolveClock(deps);
    const controller = new AbortController();
    const { deadline, handle } = startDeadline(clock, controller, azdo.timeoutMs);
    try {
      const init = {
        method: "GET" as const,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${keyCheck.key}`,
        },
        redirect: "manual" as const,
        signal: controller.signal,
      };
      const outcome = await deadline.race(() => fetchFn(urlCheck.url, init));
      if (outcome.state !== "value") return { status: "fail", code: codeForInterrupted(outcome, deadline) };
      const response = outcome.value;
      const status = readStatus(response);
      if (status === undefined) {
        discardBody(response);
        return { status: "fail", code: "bad-response" };
      }
      if (status < 200 || status > 299) {
        discardBody(response);
        return { status: "fail", code: String(status) };
      }
      if (declaredTooLarge(response)) {
        discardBody(response);
        return { status: "fail", code: "too-large" };
      }
      const body = await readCappedBody(response, deadline);
      if (typeof body === "string") return { status: "fail", code: body };
      return isJsonObjectBytes(body) ? { status: "pass" } : { status: "fail", code: "bad-response" };
    } finally {
      attempt(() => clock.clear(handle));
    }
  } catch {
    return { status: "fail", code: "internal" };
  }
}

/** Runs the Azure DevOps and Bifrost smoke checks in sequence; never rejects. */
export async function runSmoke(values: Values, apiKey: unknown, deps: SmokeDeps): Promise<SmokeReport> {
  try {
    const rawEnv = readOwn(deps, "env") as Readonly<Record<string, string | undefined>>;
    const env = pickSmokeEnv(rawEnv);
    const azdo = await checkAzdo(values, env, deps);
    const bifrost = await checkBifrost(azdo, apiKey, deps);
    return { azdo: azdo.outcome, bifrost };
  } catch {
    return {
      azdo: { status: "fail", code: "internal" },
      bifrost: { status: "skipped", code: "azdo-failed" },
    };
  }
}

function formatLine(check: "azdo" | "bifrost", outcome: SmokeOutcome): string {
  return outcome.status === "pass" ? `smoke ${check}: pass` : `smoke ${check}: ${outcome.status} ${outcome.code}`;
}

/** Formats the stdout lines of a smoke report, including the no-key hint when applicable. */
export function formatSmoke(report: SmokeReport, frontEnd: FrontEnd = "install.sh"): string[] {
  const lines = [formatLine("azdo", report.azdo), formatLine("bifrost", report.bifrost)];
  if (report.bifrost.status === "skipped" && report.bifrost.code === "no-key") {
    lines.push(`Smoke test: set KILO_BIFROST_KEY and re-run ${frontEnd} to check your Bifrost virtual key.`);
  }
  return lines;
}

/** True when at least one smoke check failed (skipped checks never fail the run). */
export function smokeFailed(report: SmokeReport): boolean {
  return report.azdo.status === "fail" || report.bifrost.status === "fail";
}
