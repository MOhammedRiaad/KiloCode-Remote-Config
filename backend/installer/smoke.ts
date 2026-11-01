// Smoke checks for the bootstrap installer (ADR-0013, ADR-0019, contract installer-cli.md sections 9 and 9.0).
// First sends one anonymous GET to each target origin (network pre-flight) and only then, when the
// origin is reachable, the credentialed checks: Azure DevOps shared-config fetch and Bifrost /models.
// Network hint rule: ADR-0019 A1, installer-cli 9.4 (N1 network fail, N2 azdo network code, N3 bifrost network code).
// Never writes files or exposes secrets, hosts, URLs, response bodies or underlying error text.
import { __internals } from "../plugin/azdo-remote-config.ts";
import { isPlainObject, PLACEHOLDER_KEY } from "./personal-config-edit.ts";
import type { Values } from "./personal-config-edit.ts";

export const SMOKE_ENV_NAMES = ["AZDO_PAT", "AZURE_DEVOPS_EXT_PAT", "KILO_AZDO_PAT", "KILO_AZDO_TIMEOUT_MS"] as const;

export type SmokeOutcome =
  | { status: "pass" }
  | { status: "fail"; code: string }
  | { status: "skipped"; code: "azdo-failed" | "no-key" | "key-reference" | "network-blocked" };

export type NetworkCode =
  | "azdo-blocked"
  | "azdo-unreachable"
  | "azdo-timeout"
  | "bifrost-blocked"
  | "bifrost-unreachable"
  | "bifrost-timeout"
  | "internal";

export type NetworkOutcome = { status: "pass" } | { status: "fail"; codes: NetworkCode[] };

export interface SmokeReport {
  network: NetworkOutcome;
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

export const AZDO_PROBE_URL = "https://dev.azure.com/";

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_KEY_CHARS = 4096;
const MAX_RESPONSE_BYTES = 1048576;
const MAX_EMPTY_CHUNKS = 1024;
const FORWARDED_DEP_KEYS = ["fetch", "runAz", "setTimeout", "clearTimeout"] as const;
export type FrontEnd = "install.sh" | "install.ps1";

type ProbeVerdict = "reachable" | "blocked" | "unreachable" | "timeout" | "internal";
type AzdoSettings = Parameters<typeof __internals.fetchRemoteConfig>[0];
type Target = "azdo" | "bifrost";
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

async function checkAzdo(
  settings: AzdoSettings,
  env: Record<string, string>,
  deps: SmokeDeps,
): Promise<AzdoCheckResult> {
  try {
    const azdoDeps: Record<string, unknown> = { env };
    for (const key of FORWARDED_DEP_KEYS) {
      const val = readOwn(deps, key);
      if (val !== undefined) azdoDeps[key] = val;
    }
    const fetched = await __internals.fetchRemoteConfig(settings, azdoDeps);
    if (!fetched.ok) return { outcome: { status: "fail", code: fetched.error } };
    let parsed: unknown;
    try {
      parsed = __internals.parseJsonc(fetched.text);
    } catch {
      return { outcome: { status: "fail", code: "invalid-jsonc" } };
    }
    if (!isPlainObject(parsed)) return { outcome: { status: "fail", code: "invalid-shape" } };
    return { outcome: { status: "pass" }, shared: parsed };
  } catch {
    return { outcome: { status: "fail", code: "internal" } };
  }
}

/** Maps a status to a probe verdict: 403/407/470 are firewall-style blocks, any other valid status is reachable. */
export function classifyProbeStatus(status: number | undefined): "reachable" | "blocked" | "unreachable" {
  if (status === undefined) return "unreachable";
  return status === 403 || status === 407 || status === 470 ? "blocked" : "reachable";
}

/** Returns "<origin>/" of an already validated models URL. */
export function probeOrigin(url: string): string {
  return `${new URL(url).origin}/`;
}

async function probe(url: string, timeoutMs: number, deps: SmokeDeps): Promise<ProbeVerdict> {
  try {
    const injectedFetch = readOwn(deps, "fetch");
    const candidateFetch = injectedFetch === undefined ? globalThis.fetch : injectedFetch;
    if (typeof candidateFetch !== "function") return "internal";
    const fetchFn = candidateFetch as NonNullable<SmokeDeps["fetch"]>;
    const clock = resolveClock(deps);
    const controller = new AbortController();
    const { deadline, handle } = startDeadline(clock, controller, timeoutMs);
    try {
      const init = { method: "GET" as const, headers: {}, redirect: "manual" as const, signal: controller.signal };
      const outcome = await deadline.race(() => fetchFn(url, init));
      if (outcome.state === "deadline" || deadline.timedOut()) {
        if (outcome.state === "value") discardBody(outcome.value);
        return "timeout";
      }
      if (outcome.state === "failed") return "unreachable";
      discardBody(outcome.value);
      return classifyProbeStatus(readStatus(outcome.value));
    } finally {
      attempt(() => clock.clear(handle));
    }
  } catch {
    return "internal";
  }
}

function networkCode(target: Target, verdict: Exclude<ProbeVerdict, "reachable">): NetworkCode {
  return verdict === "internal" ? "internal" : `${target}-${verdict}`;
}

async function checkBifrost(
  azdo: AzdoCheckResult,
  apiKey: unknown,
  deps: SmokeDeps,
  timeoutMs: number,
  codes: NetworkCode[],
): Promise<SmokeOutcome> {
  try {
    if (azdo.outcome.status !== "pass" || azdo.shared === undefined) {
      return { status: "skipped", code: "azdo-failed" };
    }
    const urlCheck = modelsUrl(readSharedBaseUrl(azdo.shared));
    if (!urlCheck.ok) return { status: "fail", code: urlCheck.code };
    const keyCheck = classifyKey(apiKey);
    if (!keyCheck.ok) return keyCheck.outcome;

    const verdict = await probe(probeOrigin(urlCheck.url), timeoutMs, deps);
    if (verdict !== "reachable") {
      codes.push(networkCode("bifrost", verdict));
      return { status: "skipped", code: "network-blocked" };
    }

    const injectedFetch = readOwn(deps, "fetch");
    const candidateFetch = injectedFetch === undefined ? globalThis.fetch : injectedFetch;
    if (typeof candidateFetch !== "function") return { status: "fail", code: "network" };
    const fetchFn = candidateFetch as NonNullable<SmokeDeps["fetch"]>;

    const clock = resolveClock(deps);
    const controller = new AbortController();
    const { deadline, handle } = startDeadline(clock, controller, timeoutMs);
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

function resolveTimeoutMs(settings: AzdoSettings): number {
  const value = (settings as { timeoutMs?: unknown }).timeoutMs;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : DEFAULT_TIMEOUT_MS;
}

function internalReport(): SmokeReport {
  return {
    network: { status: "fail", codes: ["internal"] },
    azdo: { status: "fail", code: "internal" },
    bifrost: { status: "skipped", code: "azdo-failed" },
  };
}

const CODE_ORDER: NetworkCode[] = [
  "azdo-blocked",
  "azdo-unreachable",
  "azdo-timeout",
  "bifrost-blocked",
  "bifrost-unreachable",
  "bifrost-timeout",
  "internal",
];

function toNetwork(codes: NetworkCode[]): NetworkOutcome {
  return codes.length === 0
    ? { status: "pass" }
    : { status: "fail", codes: CODE_ORDER.filter((code) => codes.includes(code)) };
}

/** Runs the network pre-flight, then the Azure DevOps and Bifrost smoke checks in sequence; never rejects. */
export async function runSmoke(values: Values, apiKey: unknown, deps: SmokeDeps): Promise<SmokeReport> {
  try {
    const rawEnv = readOwn(deps, "env") as Readonly<Record<string, string | undefined>>;
    const env = pickSmokeEnv(rawEnv);
    const { settings } = __internals.resolveSettings(values, { env });
    const timeoutMs = resolveTimeoutMs(settings);
    const codes: NetworkCode[] = [];

    const azdoVerdict = await probe(AZDO_PROBE_URL, timeoutMs, deps);
    if (azdoVerdict !== "reachable") {
      codes.push(networkCode("azdo", azdoVerdict));
      return {
        network: toNetwork(codes),
        azdo: { status: "skipped", code: "network-blocked" },
        bifrost: { status: "skipped", code: "azdo-failed" },
      };
    }
    const azdo = await checkAzdo(settings, env, deps);
    const bifrost = await checkBifrost(azdo, apiKey, deps, timeoutMs, codes);
    return { network: toNetwork(codes), azdo: azdo.outcome, bifrost };
  } catch {
    return internalReport();
  }
}

function formatLine(check: "azdo" | "bifrost", outcome: SmokeOutcome): string {
  return outcome.status === "pass" ? `smoke ${check}: pass` : `smoke ${check}: ${outcome.status} ${outcome.code}`;
}

function isNetworkOutcome(network: unknown): network is NetworkOutcome {
  const status = attempt(() => (network as { status?: unknown }).status);
  if (status === "pass") return true;
  const codes = attempt(() => (network as { codes?: unknown }).codes);
  return status === "fail" && Array.isArray(codes) && codes.length > 0 && codes.every((c) => typeof c === "string");
}

function networkLine(network: unknown): string {
  if (!isNetworkOutcome(network)) return "smoke network: fail internal";
  return network.status === "pass" ? "smoke network: pass" : `smoke network: fail ${network.codes.join(",")}`;
}

const AZDO_HINT_CODES: readonly string[] = ["network-unreachable", "network-blocked", "timeout"];
const BIFROST_HINT_CODES: readonly string[] = ["network", "timeout", "407", "470"];

function failedWith(outcome: unknown, codes: readonly string[]): boolean {
  const status = attempt(() => (outcome as { status?: unknown }).status);
  const code = attempt(() => (outcome as { code?: unknown }).code);
  return status === "fail" && typeof code === "string" && codes.includes(code);
}

function needsNetworkHint(report: SmokeReport): boolean {
  const network = report.network;
  const n1 = isNetworkOutcome(network) && network.status === "fail" && network.codes.some((code) => code !== "internal");
  return n1 || failedWith(report.azdo, AZDO_HINT_CODES) || failedWith(report.bifrost, BIFROST_HINT_CODES);
}

/** Formats the stdout lines of a smoke report, including the no-key and network hints when applicable. */
export function formatSmoke(report: SmokeReport, frontEnd: FrontEnd = "install.sh"): string[] {
  const lines = [networkLine(report.network), formatLine("azdo", report.azdo), formatLine("bifrost", report.bifrost)];
  if (report.bifrost.status === "skipped" && report.bifrost.code === "no-key") {
    lines.push(`Smoke test: set KILO_BIFROST_KEY and re-run ${frontEnd} to check your Bifrost virtual key.`);
  }
  if (needsNetworkHint(report)) {
    lines.push(
      `Smoke test: a network check failed; connect to the corporate VPN or ask the platform team to add your public IP to the Azure firewall allow-list, then re-run ${frontEnd}.`,
    );
  }
  return lines;
}

/** True when the network pre-flight or at least one smoke check failed (skipped checks never fail the run). */
export function smokeFailed(report: SmokeReport): boolean {
  return !(report.network?.status === "pass") || report.azdo.status === "fail" || report.bifrost.status === "fail";
}
