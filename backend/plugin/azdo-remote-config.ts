// azdo-remote-config: Kilo plugin that applies a remote Azure DevOps config.
// Single file, zero runtime dependencies (FR-11). See docs/architecture/ADR-0001-tech-stack.md
// and ADR-0002-plugin-module-shape.md, ADR-0003 .. ADR-0009. The config hook (runConfigHook) resolves
// the settings, fetches the shared config from Azure DevOps, caches it, falls back to the cache, merges
// it into the Kilo config transactionally and logs fixed messages. It never throws or rejects.

import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** Kilo log levels accepted by client.app.log. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Minimal subset of the Kilo plugin input that this plugin uses. Everything else is ignored. */
export interface PluginInput {
  client?: {
    app?: {
      log?: (args: {
        body: { service: string; level: LogLevel; message: string; extra?: Record<string, unknown> };
      }) => unknown | Promise<unknown>;
    };
  };
  directory?: string;
  worktree?: string;
  [key: string]: unknown;
}

/** Raw plugin options from the `plugin` tuple; validated later by F-features (FR-1). */
export type PluginOptions = Record<string, unknown> | undefined;

/** Kilo's resolved config: an arbitrary JSON object mutated in place. */
export type KiloConfig = Record<string, unknown>;

export interface Hooks {
  config: (config: KiloConfig) => Promise<void>;
}

export type PluginServer = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>;

export const PLUGIN_ID = "azdo-remote-config";

export const SUPPORTED_KILO_RANGE = ">=7.2.0 <8.0.0";

const BOM = "\uFEFF";

function isLineBreak(ch: string | undefined): boolean {
  return ch === "\n" || ch === "\r";
}

function isSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || isLineBreak(ch);
}

/** 1-based "line L, column C" for a text offset; the only input-derived data allowed in errors. */
function locate(text: string, index: number): string {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index; i++) {
    const ch = text[i];
    if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) {
      line++;
      lineStart = i + 1;
    }
  }
  return `line ${line}, column ${index - lineStart + 1}`;
}

function jsoncError(detail: string): Error {
  return new Error(`Invalid JSONC: ${detail}`);
}

/** Index just past the string that starts at `start` (a double quote); -1 when unterminated. */
function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i + 1;
  }
  return -1;
}

/** Index just past the comment starting at `start`; -1 if a block comment is unterminated; `start` if none. */
function commentEnd(text: string, start: number): number {
  if (text[start] !== "/") return start;
  if (text[start + 1] === "/") {
    let i = start + 2;
    while (i < text.length && !isLineBreak(text[i])) i++;
    return i;
  }
  if (text[start + 1] === "*") {
    for (let i = start + 2; i < text.length; i++) {
      if (text[i] === "*" && text[i + 1] === "/") return i + 2;
    }
    return -1;
  }
  return start;
}

/** True when the next significant character from `from` (skipping whitespace and comments) closes a container. */
function closesContainer(text: string, from: number): boolean {
  let i = from;
  while (i < text.length) {
    if (isSpace(text[i])) {
      i++;
      continue;
    }
    const end = commentEnd(text, i);
    if (end === -1) return false;
    if (end === i) return text[i] === "}" || text[i] === "]";
    i = end;
  }
  return false;
}

/** Blanks for a comment span, keeping line breaks so offsets map 1:1 to the input. */
function blank(text: string, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i++) out += isLineBreak(text[i]) ? text[i] : " ";
  return out;
}

/**
 * Parse JSON with comments and trailing commas. Errors never contain input text, only fixed
 * wording and 1-based line/column numbers (see ADR-0003).
 */
function parseJsonc(text: string): unknown {
  if (typeof text !== "string") throw new TypeError("Invalid JSONC: input must be a string");
  const parts: string[] = [];
  let i = 0;
  if (text.startsWith(BOM)) {
    parts.push(" ");
    i = 1;
  }
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const end = stringEnd(text, i);
      if (end === -1) throw jsoncError(`unterminated string starting at ${locate(text, i)}`);
      parts.push(text.slice(i, end));
      i = end;
    } else if (ch === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      const end = commentEnd(text, i);
      if (end === -1) throw jsoncError(`unterminated block comment starting at ${locate(text, i)}`);
      parts.push(blank(text, i, end));
      i = end;
    } else if (ch === "," && closesContainer(text, i + 1)) {
      parts.push(" ");
      i++;
    } else {
      parts.push(text.charAt(i));
      i++;
    }
  }
  try {
    return JSON.parse(parts.join(""));
  } catch {
    throw jsoncError("malformed JSON");
  }
}

// ---- Placeholder resolver (ADR-0004) ----

// Module-local types: deliberately not exported.
interface PlaceholderDeps {
  env?: Readonly<Record<string, string | undefined>>;
  homedir?: () => string;
  readFile?: (path: string) => string;
}

interface PlaceholderResult {
  value: unknown;
  unresolved: string[];
}

const PLACEHOLDER = /\{(env|file):([^{}\r\n]+)\}/g;
const WHOLE_PLACEHOLDER = /^\{(env|file):([^{}\r\n]+)\}$/;
const MAX_PLACEHOLDER_DEPTH = 64;
const MAX_PLACEHOLDER_FILE_BYTES = 1024 * 1024;
const DROP: unique symbol = Symbol("drop");

// Default reader: regular files up to the cap only. statSync runs before any open, so a FIFO or
// device is rejected without blocking. Callers discard the error.
function readGuardedFile(path: string): string {
  const st = statSync(path);
  if (!st.isFile() || st.size > MAX_PLACEHOLDER_FILE_BYTES) throw new Error("unreadable");
  return readFileSync(path, "utf8");
}

// UNC-like: the first two characters are each a forward or back slash (includes mixed forms).
function isUncLike(path: string): boolean {
  const isSlash = (c: string | undefined) => c === "/" || c === "\\";
  return isSlash(path[0]) && isSlash(path[1]);
}

// Resolves one file path to its trimmed content, or undefined. Errors are discarded on purpose:
// they may carry file contents or paths.
function readPlaceholderFile(path: string, deps: Required<PlaceholderDeps>): string | undefined {
  try {
    if (isUncLike(path)) return undefined;
    let target: string;
    if (path.startsWith("~/") || path.startsWith("~\\")) target = join(deps.homedir(), path.slice(2));
    else if (isAbsolute(path)) target = path;
    else return undefined;
    const content = deps.readFile(target);
    if (typeof content !== "string") return undefined;
    const trimmed = content.trim();
    return trimmed === "" ? undefined : trimmed;
  } catch {
    return undefined;
  }
}

function lookupPlaceholder(kind: string, name: string, deps: Required<PlaceholderDeps>): string | undefined {
  if (kind === "file") return readPlaceholderFile(name, deps);
  if (!Object.prototype.hasOwnProperty.call(deps.env, name)) return undefined;
  const value = deps.env[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function resolveContainer(
  input: object,
  depth: number,
  walk: (node: unknown, depth: number) => unknown,
): unknown {
  if (depth >= MAX_PLACEHOLDER_DEPTH) throw new Error("Placeholder resolution: config nested too deeply");
  if (Array.isArray(input)) {
    const out: unknown[] = [];
    for (const item of input) {
      const resolved = walk(item, depth + 1);
      if (resolved !== DROP) out.push(resolved);
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    const resolved = walk((input as Record<string, unknown>)[key], depth + 1);
    if (resolved === DROP) continue;
    Object.defineProperty(out, key, { value: resolved, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

// Single pass, never re-scans resolved values. Returns a new value; the input is not mutated.
function resolvePlaceholders(input: unknown, deps: PlaceholderDeps = {}): PlaceholderResult {
  const full: Required<PlaceholderDeps> = {
    env: deps.env ?? process.env,
    homedir: deps.homedir ?? homedir,
    readFile: deps.readFile ?? readGuardedFile,
  };
  const unresolved: string[] = [];
  const seen = new Set<string>();
  const note = (kind: string, name: string): void => {
    const entry = `${kind}:${name}`;
    if (seen.has(entry)) return;
    seen.add(entry);
    unresolved.push(entry);
  };
  const resolveString = (text: string): unknown => {
    const whole = WHOLE_PLACEHOLDER.exec(text);
    if (whole) {
      const found = lookupPlaceholder(whole[1]!, whole[2]!, full);
      if (found !== undefined) return found;
      note(whole[1]!, whole[2]!);
      return DROP;
    }
    return text.replace(PLACEHOLDER, (_match, kind: string, name: string) => {
      const found = lookupPlaceholder(kind, name, full);
      if (found !== undefined) return found;
      note(kind, name);
      return "";
    });
  };
  const walk = (node: unknown, depth: number): unknown => {
    if (typeof node === "string") return resolveString(node);
    if (typeof node === "object" && node !== null) return resolveContainer(node, depth, walk);
    return node;
  };
  const value = walk(input, 0);
  return { value: value === DROP ? undefined : value, unresolved };
}

// ---- Config merge (ADR-0005) ----

const MAX_MERGE_DEPTH = 64;
const OMIT: unique symbol = Symbol("omit");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isApiKeyName(key: string): boolean {
  return key.toLowerCase() === "apikey";
}

function isPrototypeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function tooDeep(): Error {
  return new Error("Config merge: config nested too deeply");
}

function defineOwn(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

// Phase 1: deep clone of the shared value without secrets or prototype keys. The only phase that throws.
function sanitizeNode(node: unknown, depth: number, topLevel: boolean): unknown {
  if (node === null || typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return node;
  }
  if (Array.isArray(node)) {
    if (depth >= MAX_MERGE_DEPTH) throw tooDeep();
    return node.map((item) => {
      const clean = sanitizeNode(item, depth + 1, false);
      return clean === OMIT ? null : clean;
    });
  }
  if (!isPlainObject(node)) return OMIT;
  if (depth >= MAX_MERGE_DEPTH) throw tooDeep();
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node)) {
    if (isApiKeyName(key) || isPrototypeKey(key)) continue;
    if (topLevel && (key === "$schema" || key === "plugin")) continue;
    const clean = sanitizeNode(node[key], depth + 1, false);
    if (clean !== OMIT) defineOwn(out, key, clean);
  }
  return out;
}

function sanitizeShared(shared: Record<string, unknown>): Record<string, unknown> {
  return sanitizeNode(shared, 0, true) as Record<string, unknown>;
}

// True when the value holds an apiKey-named own key at any depth; reaching the depth cap counts as true.
function containsApiKey(value: unknown, depth: number): boolean {
  if (Array.isArray(value)) {
    if (depth >= MAX_MERGE_DEPTH) return true;
    return value.some((item) => containsApiKey(item, depth + 1));
  }
  if (!isPlainObject(value)) return false;
  if (depth >= MAX_MERGE_DEPTH) return true;
  return Object.keys(value).some((key) => isApiKeyName(key) || containsApiKey(value[key], depth + 1));
}

// Phase 2: merge the sanitized tree into the target; keys of the target not in the tree are untouched.
// An optional journal records the previous descriptor of every key before it is written.
interface JournalEntry {
  target: object;
  key: string;
  previous: PropertyDescriptor | undefined;
}

function journaledDefine(target: object, key: string, value: unknown, journal: JournalEntry[] | undefined): void {
  journal?.push({ target, key, previous: Object.getOwnPropertyDescriptor(target, key) });
  defineOwn(target, key, value);
}

function mergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  enforce: boolean,
  journal?: JournalEntry[],
): void {
  for (const key of Object.keys(source)) {
    const incoming = source[key];
    const local = hasOwn(target, key) ? target[key] : undefined;
    if (local === undefined) {
      journaledDefine(target, key, incoming, journal);
    } else if (isPlainObject(local) && isPlainObject(incoming)) {
      mergeInto(local, incoming, enforce, journal);
    } else if (enforce && !containsApiKey(local, 0)) {
      journaledDefine(target, key, incoming, journal);
    }
  }
}

// Restores the journaled descriptors in reverse order; every step is guarded on its own.
function rollback(journal: readonly JournalEntry[]): void {
  for (let i = journal.length - 1; i >= 0; i--) {
    const { target, key, previous } = journal[i]!;
    try {
      if (previous === undefined) Reflect.deleteProperty(target, key);
      else Reflect.defineProperty(target, key, previous);
    } catch {
      continue;
    }
  }
}

// Transactional merge: true when fully merged; false when it threw and was rolled back.
function applyShared(target: unknown, shared: unknown, mode: unknown): boolean {
  if (!isPlainObject(target) || !isPlainObject(shared)) return false;
  const journal: JournalEntry[] = [];
  try {
    mergeInto(target, sanitizeShared(shared), mode === "enforce", journal);
    return true;
  } catch {
    rollback(journal);
    return false;
  }
}

// Merges `shared` into `target` in place. Only mode "enforce" lets shared values win; any other
// mode keeps local values. Non-object inputs are a no-op. Throws only for over-deep or cyclic shared.
function mergeConfig(target: unknown, shared: unknown, mode?: unknown): void {
  if (!isPlainObject(target) || !isPlainObject(shared)) return;
  mergeInto(target, sanitizeShared(shared), mode === "enforce");
}

// ---- Settings resolution (ADR-0006) ----

// Module-local types: deliberately not exported.
type Mode = "defaults" | "enforce";
type RequiredSetting = "org" | "project" | "repo";

interface Settings {
  org: string | undefined;
  project: string | undefined;
  repo: string | undefined;
  path: string;
  branch: string;
  mode: Mode;
  pat: string | undefined; // own non-enumerable property
  timeoutMs: number;
}

interface SettingsDeps {
  env?: Readonly<Record<string, string | undefined>>;
}

interface SettingsResult {
  settings: Settings;
  missing: RequiredSetting[];
  warnings: string[];
}

// undefined: absent or empty (skip silently); { value }: valid; { warn }: invalid (fixed text only).
type Check = undefined | { value: unknown } | { warn: string };

interface SettingSpec {
  name: string;
  env: string;
  check: (raw: unknown) => Check;
}

const DEFAULT_PATH = "/kilo.jsonc";
const DEFAULT_BRANCH = "main";
const DEFAULT_MODE: Mode = "defaults";
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 2147483647;

const WARN_NOT_STRING = "expected a string.";
const WARN_NOT_ALLOWED = "contains characters or segments that are not allowed.";
const WARN_MODE = 'expected "defaults" or "enforce".';
const WARN_TIMEOUT = "expected a whole number of milliseconds from 1 to 2147483647.";
const WARN_OPTIONS = "Ignored plugin options: expected an object.";

// Own data property only; getters are never invoked and any throw counts as absent.
function readOwn(source: unknown, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

// Non-null, non-array object; a revoked proxy counts as not an object.
function isRecordLike(value: unknown): boolean {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

// True when every surrogate is part of a valid pair (no lone high or low surrogate).
function isWellFormedText(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xdc00 && code <= 0xdfff) return false;
    if (code < 0xd800 || code > 0xdbff) continue;
    const next = text.charCodeAt(i + 1);
    if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    i++;
  }
  return true;
}

function hasAnyChar(text: string, chars: string): boolean {
  for (const ch of chars) if (text.includes(ch)) return true;
  return false;
}

function isAbsentValue(raw: unknown): boolean {
  return raw === undefined || raw === null;
}

// Shared shape for string settings: absent/empty skip, non-string and rule failures warn.
function checkString(raw: unknown, accept: (trimmed: string) => unknown): Check {
  if (isAbsentValue(raw)) return undefined;
  if (typeof raw !== "string") return { warn: WARN_NOT_STRING };
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = accept(trimmed);
  return value === undefined ? { warn: WARN_NOT_ALLOWED } : { value };
}

function acceptName(trimmed: string): string | undefined {
  if (!isWellFormedText(trimmed) || hasControlChar(trimmed) || hasAnyChar(trimmed, "/\\?#%")) return undefined;
  return trimmed === "." || trimmed === ".." ? undefined : trimmed;
}

function acceptBranch(trimmed: string): string | undefined {
  if (!isWellFormedText(trimmed) || hasControlChar(trimmed) || hasAnyChar(trimmed, " \\?#%")) return undefined;
  if (trimmed.includes("..") || trimmed.includes("//")) return undefined;
  return trimmed.startsWith("/") || trimmed.endsWith("/") ? undefined : trimmed;
}

function acceptPath(trimmed: string): string | undefined {
  if (!isWellFormedText(trimmed) || hasControlChar(trimmed) || hasAnyChar(trimmed, "\\?#%")) return undefined;
  const normalised = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const segments = normalised.slice(1).split("/");
  return segments.every((s) => s !== "" && s !== "." && s !== "..") ? normalised : undefined;
}

function checkMode(raw: unknown): Check {
  if (isAbsentValue(raw)) return undefined;
  if (typeof raw === "string" && raw.trim() === "") return undefined;
  const trimmed = typeof raw === "string" ? raw.trim() : undefined;
  return trimmed === "defaults" || trimmed === "enforce" ? { value: trimmed } : { warn: WARN_MODE };
}

function checkPat(raw: unknown): Check {
  return checkString(raw, (trimmed) => trimmed);
}

function isDigitString(text: string): boolean {
  if (text === "") return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x30 || code > 0x39) return false;
  }
  return true;
}

function inTimeoutRange(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX_TIMEOUT_MS;
}

function checkTimeout(raw: unknown): Check {
  if (isAbsentValue(raw)) return undefined;
  if (typeof raw === "string" && raw.trim() === "") return undefined;
  let candidate = Number.NaN;
  if (typeof raw === "number") candidate = raw;
  else if (typeof raw === "string" && isDigitString(raw.trim())) candidate = Number(raw.trim());
  return inTimeoutRange(candidate) ? { value: candidate } : { warn: WARN_TIMEOUT };
}

const SETTING_SPECS = {
  org: { name: "org", env: "KILO_AZDO_ORG", check: (raw) => checkString(raw, acceptName) },
  project: { name: "project", env: "KILO_AZDO_PROJECT", check: (raw) => checkString(raw, acceptName) },
  repo: { name: "repo", env: "KILO_AZDO_REPO", check: (raw) => checkString(raw, acceptName) },
  path: { name: "path", env: "KILO_AZDO_PATH", check: (raw) => checkString(raw, acceptPath) },
  branch: { name: "branch", env: "KILO_AZDO_BRANCH", check: (raw) => checkString(raw, acceptBranch) },
  mode: { name: "mode", env: "KILO_AZDO_MODE", check: checkMode },
  pat: { name: "pat", env: "KILO_AZDO_PAT", check: checkPat },
  timeoutMs: { name: "timeoutMs", env: "KILO_AZDO_TIMEOUT_MS", check: checkTimeout },
} satisfies Record<string, SettingSpec>;

// Option first, then env; an invalid source warns (fixed text) and falls through. undefined: use default.
function pickSetting(spec: SettingSpec, options: unknown, env: unknown, warnings: string[]): unknown {
  const sources: Array<[unknown, string, string]> = [
    [options, spec.name, `plugin option ${spec.name}`],
    [env, spec.env, `environment variable ${spec.env} (${spec.name})`],
  ];
  for (const [source, key, label] of sources) {
    const result = spec.check(readOwn(source, key));
    if (result === undefined) continue;
    if ("warn" in result) warnings.push(`Ignored ${label}: ${result.warn}`);
    else return result.value;
  }
  return undefined;
}

function selectEnv(deps: unknown): unknown {
  const injected = readOwn(deps, "env");
  if (injected === undefined) return process.env;
  return isRecordLike(injected) ? injected : {};
}

// Resolves settings: option > KILO_AZDO_* env > default. Never throws, never mutates its inputs.
// Warnings and `missing` hold fixed texts only; the PAT is reachable solely through settings.pat.
function resolveSettings(options?: unknown, deps?: SettingsDeps): SettingsResult {
  const warnings: string[] = [];
  const optionsObject = isRecordLike(options) ? options : undefined;
  if (optionsObject === undefined && !isAbsentValue(options)) warnings.push(WARN_OPTIONS);
  const env = selectEnv(deps);
  const pick = (spec: SettingSpec): unknown => pickSetting(spec, optionsObject, env, warnings);
  const org = pick(SETTING_SPECS.org) as string | undefined;
  const project = pick(SETTING_SPECS.project) as string | undefined;
  const repo = pick(SETTING_SPECS.repo) as string | undefined;
  const path = (pick(SETTING_SPECS.path) as string | undefined) ?? DEFAULT_PATH;
  const branch = (pick(SETTING_SPECS.branch) as string | undefined) ?? DEFAULT_BRANCH;
  const mode = (pick(SETTING_SPECS.mode) as Mode | undefined) ?? DEFAULT_MODE;
  const pat = pick(SETTING_SPECS.pat) as string | undefined;
  const timeoutMs = (pick(SETTING_SPECS.timeoutMs) as number | undefined) ?? DEFAULT_TIMEOUT_MS;
  const settings = { org, project, repo, path, branch, mode, timeoutMs } as Settings;
  Object.defineProperty(settings, "pat", { value: pat, enumerable: false, writable: false, configurable: false });
  const missing: RequiredSetting[] = [];
  if (org === undefined) missing.push("org");
  if (project === undefined) missing.push("project");
  if (repo === undefined) missing.push("repo");
  return { settings, missing, warnings };
}

// ---- Azure DevOps fetch and auth (ADR-0007) ----

// Module-local types: deliberately not exported.
type FetchErrorCode =
  | "invalid-settings"
  | "auth-unavailable"
  | "timeout"
  | "too-large"
  | "bad-response"
  | "network"
  | `http-${number}`;

type FetchResult = { ok: true; text: string } | { ok: false; error: FetchErrorCode };

interface FetchInit {
  method: "GET";
  headers: Record<string, string>;
  redirect: "manual";
  signal: AbortSignal;
}

type FetchLike = (url: string, init: FetchInit) => Promise<unknown>;

interface AzRunResult {
  exitCode: number | null;
  stdout: string;
}

type AzRunner = (args: readonly string[], options: { timeoutMs: number }) => Promise<AzRunResult>;

interface FetchTarget {
  org: string;
  project: string;
  repo: string;
  path: string;
  branch: string;
}

// Result of one raced external operation.
type Outcome = { state: "value"; value: unknown } | { state: "failed" } | { state: "deadline" };

interface Clock {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

interface Deadline {
  race: (op: () => unknown) => Promise<Outcome>;
  timedOut: () => boolean;
}

const MAX_RESPONSE_BYTES = 1048576;
const MAX_EMPTY_CHUNKS = 1024;
const MAX_TOKEN_CHARS = 16384;
const AZ_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
const AZ_TOKEN_ARGS: readonly string[] = Object.freeze([
  "account",
  "get-access-token",
  "--resource",
  AZ_RESOURCE,
  "--query",
  "accessToken",
  "--output",
  "tsv",
]);
const AZ_COMMAND_LINE = `az ${AZ_TOKEN_ARGS.join(" ")}`;
const AZDO_HOST_PREFIX = "https://dev.azure.com/";
const AZ_MAX_BUFFER = 65536;

function failure(error: FetchErrorCode): FetchResult {
  return { ok: false, error };
}

// Runs a probe that may throw (hostile objects, throwing getters); a throw counts as undefined.
function attempt<T>(probe: () => T): T | undefined {
  try {
    return probe();
  } catch {
    return undefined;
  }
}

function noop(): void {}

// A non-empty string without surrounding whitespace that the ADR-0006 validator accepts unchanged.
function validField(raw: unknown, accept: (trimmed: string) => string | undefined): string | undefined {
  if (typeof raw !== "string" || raw === "" || raw !== raw.trim()) return undefined;
  return isWellFormedText(raw) && accept(raw) === raw ? raw : undefined;
}

function readTarget(settings: unknown): FetchTarget | undefined {
  if (!isRecordLike(settings)) return undefined;
  const org = validField(readOwn(settings, "org"), acceptName);
  const project = validField(readOwn(settings, "project"), acceptName);
  const repo = validField(readOwn(settings, "repo"), acceptName);
  const path = validField(readOwn(settings, "path"), acceptPath);
  const branch = validField(readOwn(settings, "branch"), acceptBranch);
  if (org === undefined || project === undefined || repo === undefined) return undefined;
  if (path === undefined || branch === undefined) return undefined;
  return { org, project, repo, path, branch };
}

function readTimeoutMs(settings: unknown): number {
  const raw = readOwn(settings, "timeoutMs");
  return typeof raw === "number" && inTimeoutRange(raw) ? raw : DEFAULT_TIMEOUT_MS;
}

function buildItemsUrl(target: FetchTarget): string {
  return (
    AZDO_HOST_PREFIX +
    encodeURIComponent(target.org) +
    "/" +
    encodeURIComponent(target.project) +
    "/_apis/git/repositories/" +
    encodeURIComponent(target.repo) +
    "/items?path=" +
    encodeURIComponent(target.path) +
    "&versionDescriptor.version=" +
    encodeURIComponent(target.branch) +
    "&versionDescriptor.versionType=branch" +
    "&includeContent=true" +
    "&api-version=7.1"
  );
}

// Absent: the real global fetch (read at call time). Injected but not a function: unavailable.
function resolveFetch(deps: unknown): FetchLike | undefined {
  const injected = readOwn(deps, "fetch");
  const candidate = injected === undefined ? globalThis.fetch : injected;
  return typeof candidate === "function" ? (candidate as FetchLike) : undefined;
}

function resolveRunner(deps: unknown): AzRunner | undefined {
  const injected = readOwn(deps, "runAz");
  if (injected === undefined) return defaultRunAz;
  return typeof injected === "function" ? (injected as AzRunner) : undefined;
}

function resolveClock(deps: unknown): Clock {
  const set = readOwn(deps, "setTimeout");
  const clear = readOwn(deps, "clearTimeout");
  return {
    set: (typeof set === "function" ? set : globalThis.setTimeout) as Clock["set"],
    clear: (typeof clear === "function" ? clear : globalThis.clearTimeout) as Clock["clear"],
  };
}

// One AbortController and one timer for the whole operation. Every raced operation is also guarded
// against synchronous throws and later rejections.
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
      (value): Outcome => ({ state: "value", value }),
      (): Outcome => ({ state: "failed" }),
    );
  return {
    deadline: { race: (op) => Promise.race([settle(op), expired]), timedOut: () => fired },
    handle,
  };
}

function isVisibleAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
}

function usablePat(candidate: unknown): string | undefined {
  if (typeof candidate !== "string") return undefined;
  const trimmed = candidate.trim();
  return trimmed !== "" && isVisibleAscii(trimmed) ? trimmed : undefined;
}

// settings.pat, then AZDO_PAT, then AZURE_DEVOPS_EXT_PAT; later sources are read only when needed.
function findPat(settings: unknown, deps: unknown): string | undefined {
  const fromSettings = usablePat(readOwn(settings, "pat"));
  if (fromSettings !== undefined) return fromSettings;
  const env = selectEnv(deps);
  return usablePat(readOwn(env, "AZDO_PAT")) ?? usablePat(readOwn(env, "AZURE_DEVOPS_EXT_PAT"));
}

function basicHeader(pat: string): string {
  return `Basic ${Buffer.from(`:${pat}`, "utf8").toString("base64")}`;
}

function isTokenChar(code: number): boolean {
  if (code >= 0x30 && code <= 0x39) return true;
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return true;
  return code === 0x2d || code === 0x2e || code === 0x5f || code === 0x7e || code === 0x2b || code === 0x2f;
}

// token68: letters, digits and - . _ ~ + / with optional trailing "=" padding.
function isToken68(text: string): boolean {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 0x3d) end--;
  if (end === 0) return false;
  for (let i = 0; i < end; i++) {
    if (!isTokenChar(text.charCodeAt(i))) return false;
  }
  return true;
}

function bearerFrom(result: unknown): string | undefined {
  if (!isRecordLike(result) || readOwn(result, "exitCode") !== 0) return undefined;
  const stdout = readOwn(result, "stdout");
  if (typeof stdout !== "string") return undefined;
  const token = stdout.trim();
  if (token === "" || token.length > MAX_TOKEN_CHARS || !isToken68(token)) return undefined;
  return `Bearer ${token}`;
}

async function azAuthorization(deps: unknown, deadline: Deadline, timeoutMs: number): Promise<string | undefined> {
  const runner = resolveRunner(deps);
  if (runner === undefined) return undefined;
  const outcome = await deadline.race(() => runner(AZ_TOKEN_ARGS, { timeoutMs }));
  return outcome.state === "value" ? bearerFrom(outcome.value) : undefined;
}

async function resolveAuthorization(
  settings: unknown,
  deps: unknown,
  deadline: Deadline,
  timeoutMs: number,
): Promise<string | undefined> {
  const pat = findPat(settings, deps);
  return pat !== undefined ? basicHeader(pat) : azAuthorization(deps, deadline, timeoutMs);
}

function codeForInterrupted(outcome: Outcome, deadline: Deadline): FetchErrorCode {
  return outcome.state === "deadline" || deadline.timedOut() ? "timeout" : "network";
}

// Guarded and never awaited: a failing cancel must not change the result.
function discard(cancel: () => unknown): void {
  attempt(() => {
    Promise.resolve(cancel()).catch(noop);
  });
}

function discardBody(response: unknown): void {
  discard(() => (response as { body: { cancel: () => unknown } }).body.cancel());
}

function declaredTooLarge(response: unknown): boolean {
  const header = attempt(() =>
    (response as { headers: { get: (name: string) => unknown } }).headers.get("content-length"),
  );
  return typeof header === "string" && isDigitString(header) && Number(header) > MAX_RESPONSE_BYTES;
}

function readStatus(response: unknown): number | undefined {
  const status = attempt(() => (response as { status: unknown }).status);
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

interface BodyReader {
  read: () => unknown;
  cancel: () => unknown;
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

// Streams the body with a running byte total; returns the bytes or the failure code.
async function readCappedBody(response: unknown, deadline: Deadline): Promise<Uint8Array | FetchErrorCode> {
  const reader = openReader(response);
  if (reader === undefined) return "bad-response";
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

function extractContent(bytes: Uint8Array): FetchResult {
  const text = attempt(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const parsed = text === undefined ? undefined : attempt(() => JSON.parse(text) as unknown);
  const content = readOwn(parsed, "content");
  if (!isRecordLike(parsed) || typeof content !== "string") return failure("bad-response");
  return { ok: true, text: content };
}

async function handleResponse(response: unknown, deadline: Deadline): Promise<FetchResult> {
  const status = readStatus(response);
  if (status === undefined) {
    discardBody(response);
    return failure("bad-response");
  }
  if (status < 200 || status > 299) {
    discardBody(response);
    return failure(`http-${status}` as const);
  }
  if (declaredTooLarge(response)) {
    discardBody(response);
    return failure("too-large");
  }
  const body = await readCappedBody(response, deadline);
  return typeof body === "string" ? failure(body) : extractContent(body);
}

async function performRequest(
  url: string,
  fetchFn: FetchLike,
  authorization: string,
  controller: AbortController,
  deadline: Deadline,
): Promise<FetchResult> {
  const init: FetchInit = {
    method: "GET",
    headers: { Accept: "application/json", Authorization: authorization, "X-TFS-FedAuthRedirect": "Suppress" },
    redirect: "manual",
    signal: controller.signal,
  };
  const outcome = await deadline.race(() => fetchFn(url, init));
  if (outcome.state !== "value") return failure(codeForInterrupted(outcome, deadline));
  return handleResponse(outcome.value, deadline);
}

async function runFetch(settings: unknown, deps: unknown): Promise<FetchResult> {
  const target = readTarget(settings);
  if (target === undefined) return failure("invalid-settings");
  const options = isRecordLike(deps) ? deps : {};
  const fetchFn = resolveFetch(options);
  if (fetchFn === undefined) return failure("network");
  const timeoutMs = readTimeoutMs(settings);
  const clock = resolveClock(options);
  const controller = new AbortController();
  const { deadline, handle } = startDeadline(clock, controller, timeoutMs);
  try {
    const authorization = await resolveAuthorization(settings, options, deadline, timeoutMs);
    if (authorization === undefined) return failure("auth-unavailable");
    return await performRequest(buildItemsUrl(target), fetchFn, authorization, controller, deadline);
  } finally {
    attempt(() => clock.clear(handle));
  }
}

// Fetches the shared kilo.jsonc text from Azure DevOps. Never throws or rejects; results hold fixed
// codes only (no message, value, URL, PAT or token). The response text is returned unparsed.
async function fetchRemoteConfig(settings: unknown, deps?: unknown): Promise<FetchResult> {
  try {
    return await runFetch(settings, deps);
  } catch {
    return failure("network");
  }
}

function toAzResult(error: { code?: unknown } | null, stdout: unknown): AzRunResult {
  if (error === null || error === undefined) return { exitCode: 0, stdout: typeof stdout === "string" ? stdout : "" };
  const code = attempt(() => error.code);
  return { exitCode: typeof code === "number" ? code : null, stdout: "" };
}

// Windows: az is a .cmd batch file, which Node will not spawn without a shell, so cmd.exe is run
// explicitly with a command line made only of module constants.
function windowsCommandInterpreter(): string {
  const comspec = readOwn(process.env, "ComSpec");
  return typeof comspec === "string" && isAbsolute(comspec) ? comspec : "cmd.exe";
}

// Default az runner: execFile without a shell option. cwd is the home directory so that an az
// executable planted in a project directory is never picked up. Not covered by automated tests.
function defaultRunAz(args: readonly string[], options: { timeoutMs: number }): Promise<AzRunResult> {
  return new Promise<AzRunResult>((resolve) => {
    const execOptions = {
      timeout: options.timeoutMs,
      maxBuffer: AZ_MAX_BUFFER,
      windowsHide: true,
      encoding: "utf8" as const,
      cwd: homedir(),
    };
    const done = (error: { code?: unknown } | null, stdout: unknown): void => resolve(toAzResult(error, stdout));
    if (process.platform === "win32") {
      execFile(windowsCommandInterpreter(), ["/d", "/s", "/c", AZ_COMMAND_LINE], execOptions, done);
    } else {
      execFile("az", [...args], execOptions, done);
    }
  });
}

// ---- Config hook: cache, fallback, logging, never-crash (ADR-0008, ADR-0009) ----

// Module-local types: deliberately not exported.
interface CacheFs {
  mkdirSync(path: string, options: { recursive: true; mode: number }): unknown;
  writeFileSync(path: string, data: string, options: { encoding: "utf8"; mode: number; flag: "wx" }): void;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
  statSync(path: string): { isFile(): boolean; size: number };
  readFileSync(path: string, encoding: "utf8"): string;
}

type SharedCheck = { ok: true; value: Record<string, unknown> } | { ok: false; error: "invalid-jsonc" | "invalid-shape" };
type CacheWriteCode = "cache-unavailable" | "cache-too-large" | "cache-write-failed";
type CacheReadCode = "cache-unavailable" | "cache-missing" | "cache-unreadable" | "cache-invalid";
type CacheWrite = { ok: true } | { ok: false; error: CacheWriteCode };
type CacheRead = { ok: true; value: Record<string, unknown> } | { ok: false; error: CacheReadCode };
type Acquired = { ok: true; value: Record<string, unknown> } | { ok: false; reason: string };
type HookLog = (level: LogLevel, message: string) => void;
type HookDeps = Record<string, unknown>;

const MAX_CACHE_BYTES = 2 * 1024 * 1024;
const MAX_LOGGED_PLACEHOLDERS = 20;
const MAX_LOGGED_NAME_CHARS = 200;
const HOOK_DEP_KEYS = ["env", "fetch", "runAz", "setTimeout", "clearTimeout", "homedir", "readFile", "fs"] as const;
const REAL_FS: CacheFs = { mkdirSync, writeFileSync, renameSync, unlinkSync, statSync, readFileSync };

const LOG_REMOTE = "Loaded shared config from Azure DevOps.";
const LOG_MERGE = "Could not apply the shared config; local config left unchanged.";
const LOG_BADCONFIG = "Shared config not applied: the Kilo config is not an object.";
const LOG_UNEXPECTED = "Remote config failed unexpectedly; continuing with local config only.";

let cacheCounter = 0;

// A container at nesting level 64 or deeper (root = level 0).
function exceedsDepth(node: unknown, depth: number): boolean {
  if (typeof node !== "object" || node === null) return false;
  if (depth >= MAX_MERGE_DEPTH) return true;
  const children: unknown[] = Array.isArray(node) ? node : Object.values(node);
  return children.some((child) => exceedsDepth(child, depth + 1));
}

// Fetched text and cache text are untrusted; both pass through here. The parse error is discarded.
function validateShared(text: unknown): SharedCheck {
  let parsed: unknown;
  try {
    if (typeof text !== "string") return { ok: false, error: "invalid-jsonc" };
    parsed = parseJsonc(text);
  } catch {
    return { ok: false, error: "invalid-jsonc" };
  }
  if (!isPlainObject(parsed) || exceedsDepth(parsed, 0)) return { ok: false, error: "invalid-shape" };
  return { ok: true, value: parsed };
}

// ---- cache ----

interface CacheLocation {
  dir: string;
  file: string;
}

// Only an absolute home directory from a function gives a location; anything else is unavailable.
function cacheLocation(homeFn: unknown): CacheLocation | undefined {
  try {
    if (typeof homeFn !== "function") return undefined;
    const home: unknown = homeFn();
    if (typeof home !== "string" || home === "" || !isAbsolute(home)) return undefined;
    const dir = join(home, ".cache", "kilo-azdo");
    return { dir, file: join(dir, "remote-config.json") };
  } catch {
    return undefined;
  }
}

function selectFs(raw: unknown): CacheFs | undefined {
  if (raw === undefined) return REAL_FS;
  return isRecordLike(raw) ? (raw as CacheFs) : undefined;
}

function nextTempPath(file: string): string {
  cacheCounter += 1;
  return `${file}.${process.pid}-${Date.now()}-${cacheCounter}.tmp`;
}

function removeTemp(fs: CacheFs, tmp: string | undefined): void {
  if (tmp === undefined) return;
  try {
    fs.unlinkSync(tmp);
  } catch {
    return;
  }
}

function writeCache(shared: Record<string, unknown>, homeFn: unknown, rawFs: unknown): CacheWrite {
  const location = cacheLocation(homeFn);
  const fs = selectFs(rawFs);
  if (location === undefined || fs === undefined) return { ok: false, error: "cache-unavailable" };
  let tmp: string | undefined;
  try {
    const data = `${JSON.stringify(sanitizeShared(shared), null, 2)}\n`;
    if (Buffer.byteLength(data, "utf8") > MAX_CACHE_BYTES) return { ok: false, error: "cache-too-large" };
    fs.mkdirSync(location.dir, { recursive: true, mode: 0o700 });
    const candidate = nextTempPath(location.file);
    tmp = candidate;
    fs.writeFileSync(candidate, data, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(candidate, location.file);
    return { ok: true };
  } catch {
    removeTemp(fs, tmp);
    return { ok: false, error: "cache-write-failed" };
  }
}

function readCache(homeFn: unknown, rawFs: unknown): CacheRead {
  const location = cacheLocation(homeFn);
  const fs = selectFs(rawFs);
  if (location === undefined || fs === undefined) return { ok: false, error: "cache-unavailable" };
  let text: unknown;
  try {
    const st = fs.statSync(location.file);
    if (!st.isFile() || st.size > MAX_CACHE_BYTES) return { ok: false, error: "cache-unreadable" };
    text = fs.readFileSync(location.file, "utf8");
  } catch (error) {
    const code = attempt(() => (error as { code?: unknown }).code);
    return { ok: false, error: code === "ENOENT" ? "cache-missing" : "cache-unreadable" };
  }
  if (typeof text !== "string") return { ok: false, error: "cache-unreadable" };
  const checked = validateShared(text);
  return checked.ok ? checked : { ok: false, error: "cache-invalid" };
}

// ---- logging ----

// Fire and forget: never awaited; sync throws and rejections are swallowed. A missing logger is silent.
function makeLogger(input: unknown): HookLog {
  let app: unknown;
  let log: unknown;
  try {
    app = (input as { client?: { app?: unknown } } | null | undefined)?.client?.app;
    log = (app as { log?: unknown } | null | undefined)?.log;
  } catch {
    return noop;
  }
  if (typeof log !== "function") return noop;
  const logFn = log as (this: unknown, arg: unknown) => unknown;
  return (level, message) => {
    try {
      const result = logFn.call(app, { body: { service: PLUGIN_ID, level, message } });
      const then = (result as { then?: unknown } | null | undefined)?.then;
      if (typeof then === "function") then.call(result, noop, noop);
    } catch {
      return;
    }
  };
}

function cleanName(name: string): string {
  const cut = name.slice(0, MAX_LOGGED_NAME_CHARS);
  let out = "";
  for (let i = 0; i < cut.length; i++) {
    const code = cut.charCodeAt(i);
    out += code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? "?" : cut[i];
  }
  return out;
}

function listNames(names: readonly string[]): string {
  const shown = names.slice(0, MAX_LOGGED_PLACEHOLDERS).map(cleanName).join(", ");
  const rest = names.length - MAX_LOGGED_PLACEHOLDERS;
  return rest > 0 ? `${shown}, and ${rest} more` : shown;
}

// ---- hook ----

function readHookDeps(deps: unknown): HookDeps {
  const out: HookDeps = {};
  if (!isRecordLike(deps)) return out;
  for (const key of HOOK_DEP_KEYS) {
    const value = readOwn(deps, key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function pickDeps(all: HookDeps, keys: readonly string[]): HookDeps {
  const out: HookDeps = {};
  for (const key of keys) if (all[key] !== undefined) out[key] = all[key];
  return out;
}

async function acquireRemote(settings: unknown, deps: HookDeps): Promise<Acquired> {
  const fetched = await fetchRemoteConfig(
    settings,
    pickDeps(deps, ["fetch", "env", "runAz", "setTimeout", "clearTimeout"]),
  );
  if (!fetched.ok) return { ok: false, reason: fetched.error };
  const checked = validateShared(fetched.text);
  return checked.ok ? checked : { ok: false, reason: checked.error };
}

async function executeHook(log: HookLog, options: unknown, config: unknown, deps: HookDeps): Promise<void> {
  if (!isPlainObject(config)) {
    log("error", LOG_BADCONFIG);
    return;
  }
  const { settings, missing, warnings } = resolveSettings(options, pickDeps(deps, ["env"]));
  for (const warning of warnings) log("warn", warning);
  let remote: Acquired;
  if (missing.length > 0) {
    log("warn", `Remote config skipped: missing required settings: ${missing.join(", ")}.`);
    remote = { ok: false, reason: "missing-settings" };
  } else {
    remote = await acquireRemote(settings, deps);
  }
  const home = deps.homedir ?? homedir;
  let shared: Record<string, unknown>;
  let source: "remote" | "cache";
  if (remote.ok) {
    log("info", LOG_REMOTE);
    const written = writeCache(remote.value, home, deps.fs);
    if (!written.ok) log("warn", `Could not update the config cache (${written.error}).`);
    shared = remote.value;
    source = "remote";
  } else {
    const cached = readCache(home, deps.fs);
    if (!cached.ok) {
      log(
        "error",
        `Remote config unavailable (${remote.reason}) and no usable cache (${cached.error}); continuing with local config only.`,
      );
      return;
    }
    log("warn", `Remote config unavailable (${remote.reason}); using cached config.`);
    shared = cached.value;
    source = "cache";
  }
  const { value, unresolved } = resolvePlaceholders(shared, pickDeps(deps, ["env", "homedir", "readFile"]));
  if (unresolved.length > 0) log("warn", `Unresolved placeholders: ${listNames(unresolved)}.`);
  if (applyShared(config, value, settings.mode)) {
    log("info", `Applied shared config from ${source} in ${settings.mode} mode.`);
  } else {
    log("error", LOG_MERGE);
  }
}

// Never rejects: every failure ends as a fixed log message and an unchanged or fully merged config.
async function runConfigHook(input: unknown, options: unknown, config: unknown, deps?: unknown): Promise<void> {
  const log = makeLogger(input);
  try {
    await executeHook(log, options, config, readHookDeps(deps));
  } catch {
    log("error", LOG_UNEXPECTED);
  }
}

/** Test/validator seam. Never has a `server` key and never holds the entry point. */
export const __internals = {
  parseJsonc,
  resolvePlaceholders,
  mergeConfig,
  resolveSettings,
  fetchRemoteConfig,
  runConfigHook,
};

const AzdoRemoteConfig: PluginServer = async (input, options) => {
  return { config: (config) => runConfigHook(input, options, config) };
};

export default { id: PLUGIN_ID, server: AzdoRemoteConfig };
