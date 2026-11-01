// azdo-remote-config: Kilo plugin that applies a remote Azure DevOps config.
// Single file, zero runtime dependencies (FR-11). See docs/architecture/ADR-0001-tech-stack.md and
// ADR-0002 .. ADR-0021. The config hook (runConfigHook) resolves the settings, fetches the shared config,
// caches it bound to those settings (ADR-0018), falls back to that cache only when the settings match,
// merges it transactionally and logs fixed messages. It never throws or rejects.
// Types not marked export are module-local on purpose (ADR-0002).
//
// Table of contents (one numbered section banner per entry, same numbers, titles and order):
//   1. Imports, public types and plugin identity (ADR-0001, ADR-0002)
//   2. Shared guards and helpers
//   3. JSONC parser (ADR-0003)
//   4. Placeholder resolver (ADR-0004)
//   5. Config merge (ADR-0005)
//   6. Settings resolution (ADR-0006, ADR-0009)
//   7. Fetch foundations: types, target, URL and deadline (ADR-0007)
//   8. Authentication: PAT and az CLI (ADR-0007)
//   9. Response handling and failure classification (ADR-0007, ADR-0020)
//   10. Fetch pipeline: fetchRemoteConfig (ADR-0007)
//   11. Shared config validation (ADR-0008, ADR-0009)
//   12. Config cache bound to settings (ADR-0008, ADR-0018)
//   13. Logging, fixed messages and hints (ADR-0008, ADR-0020)
//   14. Config hook: runConfigHook (ADR-0008)
//   15. Exports: __internals, server and default export (ADR-0002)

// ==== 1. Imports, public types and plugin identity (ADR-0001, ADR-0002) ====

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

// ==== 2. Shared guards and helpers ====

function noop(): void {}

// Runs a probe that may throw (hostile objects, throwing getters); a throw counts as undefined.
function attempt<T>(probe: () => T): T | undefined {
  try {
    return probe();
  } catch {
    return undefined;
  }
}

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// ==== 3. JSONC parser (ADR-0003) ====

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

/** Index just past the comment at `start`; -1 if a block comment is unterminated; `start` if none. */
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

/** True when the first non-space, non-comment character from `from` closes a container. */
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
 * Parses JSON with comments and trailing commas.
 * @param text - the JSONC text; a leading byte order mark is allowed and comments are blanked out.
 * @returns the parsed JSON value.
 * Invariants: THROWS instead of returning an error: a TypeError for a non-string input and an Error with a
 *   message starting Invalid JSONC for an unterminated string, an unterminated block comment or malformed
 *   JSON. Errors never contain input text, only fixed wording and 1-based line and column numbers (see
 *   ADR-0003). Comment markers and commas inside strings are kept.
 * @see ADR-0003
 * @see contracts/plugin-interface.md section 2a
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

// ==== 4. Placeholder resolver (ADR-0004) ====

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

// Default reader: regular files up to the cap only (statSync first, so a FIFO or device never blocks).
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

// Resolves one path to its trimmed content, or undefined; errors are discarded as they may carry paths.
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

/**
 * Resolves {env:NAME} and {file:PATH} placeholders in every string of a parsed config.
 * @param input - any parsed JSON value; it is not mutated.
 * @param deps - optional seams env, homedir and readFile; the defaults are the real ones.
 * @returns the new value and the unresolved placeholders as kind:name entries, each once, in order.
 * Invariants: single pass, resolved values are never re-scanned; a string that is exactly one unresolved
 *   placeholder is dropped (key or array item omitted), one inside a longer string becomes empty; env names
 *   are own properties and empty values are unresolved; file paths must be absolute or start with ~,
 *   UNC-like paths are rejected, only regular files up to 1 MiB are read (trimmed, errors discarded). For
 *   parsed JSON it throws only at nesting depth 64 or more; hostile objects (throwing getters, proxies) in
 *   the input or an injected env can also make it throw.
 * @see ADR-0004
 * @see contracts/plugin-interface.md section 2b
 */
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

// ==== 5. Config merge (ADR-0005) ====

const MAX_MERGE_DEPTH = 64;
const OMIT: unique symbol = Symbol("omit");

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

// Phase 1: deep clone of the shared value without secrets or prototype keys; throws on over-deep input.
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

// Phase 2: merge the sanitized tree into the target; an optional journal records each key's old descriptor.
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

/**
 * Merges the shared config into the Kilo config as one transaction.
 * @param target - the Kilo config; changed in place.
 * @param shared - the shared config, after placeholder resolution.
 * @param mode - the string enforce lets shared values win; any other value keeps local values.
 * @returns true when fully merged; false when an input is not a plain object or the merge was rolled back.
 * Invariants: does not throw for ordinary objects (the merge runs inside try, each rollback step is guarded),
 *   but the plain-object checks run before the try, so a hostile Proxy (throwing getPrototypeOf trap,
 *   revoked proxy) can throw; every written key is journaled with its previous descriptor and restored in
 *   reverse order on failure, so for ordinary objects a failed merge leaves the config unchanged (rollback
 *   is best-effort); the merge rules are those of mergeConfig.
 * @see ADR-0008 section 6
 * @see ADR-0005
 */
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

/**
 * Merges the shared config into the Kilo config in place.
 * @param target - the Kilo config; changed in place.
 * @param shared - the shared config to merge in.
 * @param mode - the string enforce lets shared values win; any other value keeps local values.
 * Invariants: non-object inputs are a no-op. It THROWS for over-deep or cyclic shared input and when the
 *   target rejects a write (a frozen target gives a TypeError) or has a getter that throws (that getter's
 *   own error propagates, not a TypeError). Not transactional (applyShared adds rollback); apiKey-named
 *   keys, __proto__, constructor, prototype and the top-level keys $schema and plugin are never copied
 *   from shared; in enforce mode a local value that holds an apiKey is never replaced.
 * @see ADR-0005
 * @see contracts/plugin-interface.md section 2c
 */
function mergeConfig(target: unknown, shared: unknown, mode?: unknown): void {
  if (!isPlainObject(target) || !isPlainObject(shared)) return;
  mergeInto(target, sanitizeShared(shared), mode === "enforce");
}

// ==== 6. Settings resolution (ADR-0006, ADR-0009) ====

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

/**
 * Resolves the plugin settings: option first, then KILO_AZDO_ environment variable, then default.
 * @param options - the raw plugin options; a present value that is not an object is ignored with a warning.
 * @param deps - optional seams; the own property env replaces process.env.
 * @returns settings (including the own non-enumerable pat), missing (a subset of org, project, repo) and
 *   warnings (fixed texts).
 * Invariants: never throws and never mutates its inputs; an invalid value warns with a fixed text and falls
 *   through to the next source; warnings and missing hold fixed texts only; the PAT is reachable only
 *   through settings.pat.
 * @see ADR-0006
 * @see ADR-0009 section 1
 * @see contracts/plugin-interface.md section 2d
 */
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

// ==== 7. Fetch foundations: types, target, URL and deadline (ADR-0007) ====

type FetchErrorCode =
  | "invalid-settings"
  | "auth-unavailable"
  | "timeout"
  | "too-large"
  | "bad-response"
  | "network"
  | "network-unreachable"
  | "network-blocked"
  | `http-${number}`;

type FetchResult = { ok: true; text: string } | { ok: false; error: FetchErrorCode };

interface FetchInit {
  method: "GET";
  headers: Record<string, string>;
  redirect: "manual";
  signal: AbortSignal;
}

type FetchLike = (url: string, init: FetchInit) => Promise<unknown>;

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

const AZDO_HOST_PREFIX = "https://dev.azure.com/";

function failure(error: FetchErrorCode): FetchResult {
  return { ok: false, error };
}

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

/**
 * Builds the Items API URL for a validated target.
 * @param target - the validated org, project, repo, path and branch.
 * @returns https://dev.azure.com/<org>/<project>/_apis/git/repositories/<repo>/items with the query path,
 *   versionDescriptor.version and .versionType=branch, includeContent=true and api-version=7.1.
 * Invariants: pure; the scheme and host are the fixed AZDO_HOST_PREFIX and every variable part goes through
 *   encodeURIComponent, which throws only for lone surrogates that readTarget has already rejected.
 * @see ADR-0007 section 5
 * @see contracts/plugin-interface.md section 5
 */
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

function resolveClock(deps: unknown): Clock {
  const set = readOwn(deps, "setTimeout");
  const clear = readOwn(deps, "clearTimeout");
  return {
    set: (typeof set === "function" ? set : globalThis.setTimeout) as Clock["set"],
    clear: (typeof clear === "function" ? clear : globalThis.clearTimeout) as Clock["clear"],
  };
}

/**
 * Starts the one timer and AbortController that bound the whole fetch operation.
 * @param clock - the timer functions (set, clear), real or injected.
 * @param controller - the AbortController aborted when the deadline fires.
 * @param timeoutMs - the deadline in milliseconds.
 * @returns the deadline (race and timedOut) and the timer handle that the caller must clear.
 * Invariants: one controller and one timer for the whole operation; on expiry the controller is aborted
 *   (guarded) and the deadline outcome resolves; raced operations are guarded against throws and
 *   rejections, which become a failed outcome.
 * @see ADR-0007 section 8
 * @see ADR-0020
 */
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

/**
 * Chooses the error code for an operation that did not produce a value: the deadline wins over any failure.
 * @param outcome - the raced outcome.
 * @param failed - the code to report when the deadline did not fire (network or network-unreachable).
 * @returns timeout when the outcome is a deadline or the deadline has fired, else the failed code.
 * Codes: timeout, network, network-unreachable.
 * Invariants: pure and never throws.
 * @see ADR-0007 section 8
 * @see ADR-0020
 */
function codeForInterrupted(outcome: Outcome, deadline: Deadline, failed: FetchErrorCode): FetchErrorCode {
  return outcome.state === "deadline" || deadline.timedOut() ? "timeout" : failed;
}

// ==== 8. Authentication: PAT and az CLI (ADR-0007) ====

interface AzRunResult {
  exitCode: number | null;
  stdout: string;
}

type AzRunner = (args: readonly string[], options: { timeoutMs: number }) => Promise<AzRunResult>;

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
const AZ_MAX_BUFFER = 65536;

function resolveRunner(deps: unknown): AzRunner | undefined {
  const injected = readOwn(deps, "runAz");
  if (injected === undefined) return defaultRunAz;
  return typeof injected === "function" ? (injected as AzRunner) : undefined;
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

/**
 * Finds the first usable personal access token.
 * @param settings - the resolved settings; its own pat is read first.
 * @param deps - the seams; the env member (or process.env) is read only when needed.
 * @returns the trimmed PAT, or undefined.
 * Invariants: order is settings.pat, then AZDO_PAT, then AZURE_DEVOPS_EXT_PAT, and later sources are read
 *   only when earlier ones are unusable; a usable PAT is non-empty visible ASCII after trimming; never
 *   throws and never logs the value.
 * @see ADR-0007 section 6
 */
function findPat(settings: unknown, deps: unknown): string | undefined {
  const fromSettings = usablePat(readOwn(settings, "pat"));
  if (fromSettings !== undefined) return fromSettings;
  const env = selectEnv(deps);
  return usablePat(readOwn(env, "AZDO_PAT")) ?? usablePat(readOwn(env, "AZURE_DEVOPS_EXT_PAT"));
}

/**
 * Encodes a PAT as an HTTP Basic Authorization header value.
 * @param pat - a usable PAT from findPat.
 * @returns Basic <base64>, where the base64 text encodes an empty user name, a colon and the PAT as UTF-8.
 * Invariants: pure and never throws; the result is used only as the Authorization header, never logged.
 * @see ADR-0007 section 6
 */
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

/**
 * Obtains an Azure DevOps bearer token from the az CLI when no PAT is available.
 * @param deps - the seams; the runAz member replaces the real runner.
 * @param timeoutMs - the az child-process timeout in milliseconds.
 * @returns a promise of Bearer <token>, or undefined when the runner is unusable, fails, times out, exits
 *   non-zero or prints an invalid token; runFetch maps undefined to auth-unavailable.
 * Invariants: never throws or rejects (the runner is raced through the deadline, which guards throws and
 *   rejections); the arguments are the fixed AZ_TOKEN_ARGS; the token is at most 16384 token68 characters
 *   and is never logged.
 * @see ADR-0007 section 7
 */
async function azAuthorization(deps: unknown, deadline: Deadline, timeoutMs: number): Promise<string | undefined> {
  const runner = resolveRunner(deps);
  if (runner === undefined) return undefined;
  const outcome = await deadline.race(() => runner(AZ_TOKEN_ARGS, { timeoutMs }));
  return outcome.state === "value" ? bearerFrom(outcome.value) : undefined;
}

/**
 * Picks the Authorization value for the one Items API request: a PAT as Basic, else an az bearer token.
 * @param settings - the resolved settings; only its own non-enumerable pat is read here.
 * @param deps - the injected seams (env, runAz); absent members fall back to the real ones.
 * @param timeoutMs - the az child-process timeout in milliseconds.
 * @returns the header value, or undefined when no credential is usable (runFetch: auth-unavailable).
 * Invariants: a usable PAT always wins and az is run only when there is none; the PAT or token never
 *   reaches a log, error or result code (AC-9).
 * @see ADR-0007 section 6
 * @see contracts/plugin-interface.md section 2e
 */
async function resolveAuthorization(
  settings: unknown,
  deps: unknown,
  deadline: Deadline,
  timeoutMs: number,
): Promise<string | undefined> {
  const pat = findPat(settings, deps);
  return pat !== undefined ? basicHeader(pat) : azAuthorization(deps, deadline, timeoutMs);
}

function toAzResult(error: { code?: unknown } | null, stdout: unknown): AzRunResult {
  if (error === null || error === undefined) return { exitCode: 0, stdout: typeof stdout === "string" ? stdout : "" };
  const code = attempt(() => error.code);
  return { exitCode: typeof code === "number" ? code : null, stdout: "" };
}

// Windows: az is a .cmd file that Node will not spawn without a shell, so cmd.exe runs a constant line.
function windowsCommandInterpreter(): string {
  const comspec = readOwn(process.env, "ComSpec");
  return typeof comspec === "string" && isAbsolute(comspec) ? comspec : "cmd.exe";
}

/**
 * Real az runner: runs the fixed az account get-access-token command and reports its exit code and stdout.
 * @param args - the fixed AZ_TOKEN_ARGS (used on non-Windows platforms).
 * @param options - timeoutMs, the child-process timeout in milliseconds.
 * @returns a promise of exitCode and stdout (on any error: the numeric error code or null, and no stdout).
 * Invariants: execFile is used without a shell option; on Windows cmd.exe is run explicitly with the
 *   constant AZ_COMMAND_LINE; cwd is the home directory so an az executable planted in a project directory
 *   is never picked up; output is capped at 64 KiB; the caller races it against the deadline. Not covered
 *   by automated tests.
 * @see ADR-0007 section 7
 */
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

// ==== 9. Response handling and failure classification (ADR-0007, ADR-0020) ====

const MAX_RESPONSE_BYTES = 1048576;
const MAX_EMPTY_CHUNKS = 1024;

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

/**
 * Reads the Content-Type header of a response safely.
 * @param response - the untyped fetch response.
 * @returns the header value, or undefined when it is absent or not a primitive string.
 * Invariants: never throws: any throw (header getter, headers.get) counts as absent.
 * @see ADR-0020
 */
function readContentType(response: unknown): string | undefined {
  const value = attempt(() =>
    (response as { headers: { get: (name: string) => unknown } }).headers.get("content-type"),
  );
  return typeof value === "string" ? value : undefined;
}

/**
 * Tells whether a Content-Type value is a JSON media type.
 * @param raw - the Content-Type header value, or undefined.
 * @returns true for application/json or type/subtype+json; parameters are ignored and case does not matter.
 * Invariants: pure and never throws; an absent value is not JSON.
 * @see ADR-0020
 */
function isJsonMediaType(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const semicolon = raw.indexOf(";");
  const media = (semicolon === -1 ? raw : raw.slice(0, semicolon)).trim().toLowerCase();
  if (media === "application/json") return true;
  const slash = media.indexOf("/");
  if (slash < 1 || media.indexOf("/", slash + 1) !== -1) return false;
  return media.endsWith("+json") && media.length - slash - 1 > "+json".length;
}

/**
 * Maps a non-2xx status to a fixed error code.
 * @param status - the HTTP status, an integer from 100 to 599 outside the 2xx range.
 * @param response - the response, read only for its Content-Type header.
 * Codes: network-blocked, http-NNN.
 * Invariants: 407, 470 (Azure Firewall deny, community-reported) and a 403 that is not JSON mean a network
 *   intermediary refused the request and give network-blocked (amendment A1 for 470); every other status
 *   gives http-<status>; the body is never read and the code holds the number only.
 * @see ADR-0020
 */
function codeForStatus(status: number, response: unknown): FetchErrorCode {
  if (status === 407 || status === 470) return "network-blocked";
  if (status === 403 && !isJsonMediaType(readContentType(response))) return "network-blocked";
  return `http-${status}` as const;
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

/**
 * Streams the response body with a running byte total and a cap, racing every read against the deadline.
 * @param response - the untyped fetch response.
 * @returns a promise of the body bytes, or a fixed failure code string.
 * Codes: bad-response (no usable reader, a non-bytes chunk, over 1024 consecutive empty chunks) and
 *   too-large (over 1 MiB); the rest: contracts/plugin-interface.md section 2e.
 * Invariants: does not throw for the chunks a real fetch produces; the done and value reads and the
 *   reader.read and reader.cancel calls are guarded, but the instanceof check and the byteLength read on a
 *   chunk are not, so a hostile chunk can throw and fetchRemoteConfig maps that to network; the reader is
 *   cancelled on every early exit (a failing cancel is ignored); the 1 MiB cap is checked on the running
 *   total of chunk.byteLength, trusted as the chunk size, so no chunk that crosses the cap is accumulated.
 * @see ADR-0007 section 10
 */
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
      return codeForInterrupted(outcome, deadline, "network");
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

/**
 * Decodes the JSON response body and returns its content text.
 * @returns ok with the string content property, or not ok with bad-response.
 * Invariants: never throws; the body must be strict UTF-8 and a JSON object with an own string content
 *   property; the text is returned unparsed (parsing is the job of validateShared).
 * @see ADR-0007 section 10
 */
function extractContent(bytes: Uint8Array): FetchResult {
  const text = attempt(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const parsed = text === undefined ? undefined : attempt(() => JSON.parse(text) as unknown);
  const content = readOwn(parsed, "content");
  if (!isRecordLike(parsed) || typeof content !== "string") return failure("bad-response");
  return { ok: true, text: content };
}

/**
 * Classifies the HTTP response and extracts the content text from a successful one.
 * @param response - the untyped result of fetch; every property read is guarded.
 * @returns a promise of ok with the string content property of the JSON body, or not ok with a fixed code.
 * Codes: see contracts/plugin-interface.md section 2e.
 * Invariants: order is status check, non-2xx classification (body discarded unread), declared
 *   content-length against 1 MiB, then the capped stream read; the body is cancelled on every early exit
 *   and a failing cancel never changes the result; property reads are guarded, but a throw from a hostile
 *   chunk passes up to fetchRemoteConfig, which maps it to network.
 * @see ADR-0007 section 10
 * @see ADR-0020
 */
async function handleResponse(response: unknown, deadline: Deadline): Promise<FetchResult> {
  const status = readStatus(response);
  if (status === undefined) {
    discardBody(response);
    return failure("bad-response");
  }
  if (status < 200 || status > 299) {
    const code = codeForStatus(status, response);
    discardBody(response);
    return failure(code);
  }
  if (declaredTooLarge(response)) {
    discardBody(response);
    return failure("too-large");
  }
  const body = await readCappedBody(response, deadline);
  return typeof body === "string" ? failure(body) : extractContent(body);
}

// ==== 10. Fetch pipeline: fetchRemoteConfig (ADR-0007) ====

/**
 * Sends the one GET request with the fixed headers and hands the response to handleResponse.
 * @param url - the Items API URL from buildItemsUrl.
 * @param fetchFn - the fetch function (global or injected).
 * @param authorization - the Authorization header value.
 * @param controller - the AbortController whose signal is passed to fetch.
 * Codes: see contracts/plugin-interface.md section 2e (network-unreachable when fetch fails).
 * Invariants: exactly one request; redirect is manual, so a redirect is just a non-success status; the
 *   headers are Accept, Authorization and X-TFS-FedAuthRedirect only; the call is raced against the
 *   deadline and guarded against synchronous throws; the Authorization value is never logged or returned.
 * @see ADR-0007 section 5
 * @see ADR-0007 section 9
 */
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
  if (outcome.state !== "value") return failure(codeForInterrupted(outcome, deadline, "network-unreachable"));
  return handleResponse(outcome.value, deadline);
}

/**
 * Validates the settings, resolves the seams and the credential, and performs the single guarded request.
 * @param settings - the settings object, read through readTarget and readTimeoutMs.
 * @param deps - the seams; a value that is not an object counts as empty.
 * Codes: see contracts/plugin-interface.md section 2e; here: invalid-settings, network, auth-unavailable.
 * Invariants: settings are validated before any dependency is called; one AbortController and one deadline
 *   cover the whole operation and the timer is always cleared (finally). An unexpected throw propagates to
 *   fetchRemoteConfig, which maps it to network.
 * @see ADR-0007 section 3
 * @see contracts/plugin-interface.md section 2e
 */
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

/**
 * Fetches the shared kilo.jsonc text from Azure DevOps with one authenticated Items API request.
 * @param settings - the resolved settings; only own data properties are read, validated before any call.
 * @param deps - optional seams (fetch, runAz, env, setTimeout, clearTimeout); absent ones use the real ones.
 * @returns a promise of ok with the response content text, unparsed, or not ok with a fixed error code.
 * Codes: invalid-settings, auth-unavailable, timeout, too-large, bad-response, network,
 *   network-unreachable, network-blocked, http-NNN.
 * Invariants: never throws or rejects (an unexpected throw becomes network); results hold fixed codes only,
 *   never a message, value, URL, PAT or token (AC-9).
 * @see ADR-0007 section 1
 * @see ADR-0020
 * @see contracts/plugin-interface.md section 2e
 */
async function fetchRemoteConfig(settings: unknown, deps?: unknown): Promise<FetchResult> {
  try {
    return await runFetch(settings, deps);
  } catch {
    return failure("network");
  }
}

// ==== 11. Shared config validation (ADR-0008, ADR-0009) ====

type SharedCheck = { ok: true; value: Record<string, unknown> } | { ok: false; error: "invalid-jsonc" | "invalid-shape" };

// A container at nesting level 64 or deeper (root = level 0).
function exceedsDepth(node: unknown, depth: number): boolean {
  if (typeof node !== "object" || node === null) return false;
  if (depth >= MAX_MERGE_DEPTH) return true;
  const children: unknown[] = Array.isArray(node) ? node : Object.values(node);
  return children.some((child) => exceedsDepth(child, depth + 1));
}

/**
 * Validates fetched or cached text as a shared config (a plain JSONC object).
 * @param text - the untrusted text; anything that is not a string is invalid.
 * @returns ok with the parsed plain object, or not ok with invalid-jsonc (not a string or not parseable) or
 *   invalid-shape (not a plain object, or a container at level 64 or deeper).
 * Invariants: never throws; the parse error is discarded so no input text can leak.
 * @see ADR-0008 section 3
 * @see ADR-0009 section 2
 */
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

// ==== 12. Config cache bound to settings (ADR-0008, ADR-0018) ====

interface CacheFs {
  mkdirSync(path: string, options: { recursive: true; mode: number }): unknown;
  writeFileSync(path: string, data: string, options: { encoding: "utf8"; mode: number; flag: "wx" }): void;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
  statSync(path: string): { isFile(): boolean; size: number };
  readFileSync(path: string, encoding: "utf8"): string;
}

type CacheWriteCode = "cache-unavailable" | "cache-too-large" | "cache-write-failed";
type CacheReadCode =
  | "cache-unavailable"
  | "cache-missing"
  | "cache-unreadable"
  | "cache-invalid"
  | "cache-outdated"
  | "cache-mismatch";
type CacheWrite = { ok: true } | { ok: false; error: CacheWriteCode };
type CacheRead = { ok: true; value: Record<string, unknown> } | { ok: false; error: CacheReadCode };

interface CacheBinding {
  org: string;
  project: string;
  repo: string;
  path: string;
  branch: string;
}

interface CacheLocation {
  dir: string;
  file: string;
}

const CACHE_FORMAT = "kilo-azdo-cache-v1";
const CACHE_BINDING_KEYS = ["org", "project", "repo", "path", "branch"] as const;
const CACHE_ROOT_KEYS = ["format", "binding", "config"] as const;
const MAX_CACHE_BYTES = 2 * 1024 * 1024;
const REAL_FS: CacheFs = { mkdirSync, writeFileSync, renameSync, unlinkSync, statSync, readFileSync };
let cacheCounter = 0;

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

/**
 * Builds the cache binding from the resolved settings.
 * @returns the five-field binding, or undefined unless org, project, repo, path and branch are all strings.
 * Invariants: pure and never throws; the binding is built field by field (never spread or serialised from
 *   settings) and never holds mode, timeoutMs or the PAT.
 * @see ADR-0018 section 1
 * @see contracts/plugin-interface.md section 2f-C
 */
function cacheBindingOf(settings: Settings): CacheBinding | undefined {
  const { org, project, repo, path, branch } = settings;
  if (typeof org !== "string" || typeof project !== "string" || typeof repo !== "string") return undefined;
  if (typeof path !== "string" || typeof branch !== "string") return undefined;
  return { org, project, repo, path, branch };
}

function hasExactKeys(node: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(node).length === keys.length && keys.every((key) => Object.hasOwn(node, key));
}

function isStringBinding(node: unknown): node is Record<string, string> {
  return (
    isPlainObject(node) &&
    hasExactKeys(node, CACHE_BINDING_KEYS) &&
    CACHE_BINDING_KEYS.every((key) => typeof readOwn(node, key) === "string")
  );
}

function matchesBinding(stored: Record<string, string>, current: CacheBinding): boolean {
  return CACHE_BINDING_KEYS.every((key) => readOwn(stored, key) === current[key]);
}

/**
 * Validates the cache file text and compares its binding with the current settings.
 * @param text - the cache file content.
 * @param current - the current settings binding.
 * @returns ok with the cached config, or not ok with cache-invalid, cache-outdated or cache-mismatch.
 * Invariants: never throws; fail-closed; the checks run in order: parse, plain-object root, format marker
 *   (cache-outdated), exactly the keys format, binding and config, a binding of exactly five strings, a
 *   plain-object config of bounded depth, and only then the strict string comparison (cache-mismatch).
 * @see ADR-0018 section 2
 * @see contracts/plugin-interface.md section 2f-C
 */
function checkCacheEnvelope(text: string, current: CacheBinding): CacheRead {
  let root: unknown;
  try {
    root = parseJsonc(text);
  } catch {
    return { ok: false, error: "cache-invalid" };
  }
  if (!isPlainObject(root)) return { ok: false, error: "cache-invalid" };
  if (readOwn(root, "format") !== CACHE_FORMAT) return { ok: false, error: "cache-outdated" };
  if (!hasExactKeys(root, CACHE_ROOT_KEYS)) return { ok: false, error: "cache-invalid" };
  const binding = readOwn(root, "binding");
  const config = readOwn(root, "config");
  if (!isStringBinding(binding)) return { ok: false, error: "cache-invalid" };
  if (!isPlainObject(config) || exceedsDepth(config, 0)) return { ok: false, error: "cache-invalid" };
  if (!matchesBinding(binding, current)) return { ok: false, error: "cache-mismatch" };
  return { ok: true, value: config };
}

function bindingCopy(binding: CacheBinding): CacheBinding {
  const { org, project, repo, path, branch } = binding;
  return { org, project, repo, path, branch };
}

/**
 * Writes the validated shared config and its binding to the cache file atomically.
 * @param shared - the validated shared config; it is stored sanitised and unresolved.
 * @param binding - the current settings binding.
 * @param homeFn - a function returning the absolute home directory.
 * @param rawFs - an injected file system, or undefined for the real one.
 * @returns ok, or not ok with cache-unavailable, cache-too-large (more than 2 MiB) or cache-write-failed.
 * Invariants: never throws; the file holds the format marker, a binding copied field by field and
 *   sanitizeShared(shared) (no apiKey, PAT, token or resolved placeholder); the directory is created with
 *   mode 0o700, a unique 0o600 temp file (flag wx) is renamed over the cache file and removed on failure.
 * @see ADR-0018 section 4
 * @see contracts/plugin-interface.md section 2f-C
 */
function writeCache(
  shared: Record<string, unknown>,
  binding: CacheBinding,
  homeFn: unknown,
  rawFs: unknown,
): CacheWrite {
  const location = cacheLocation(homeFn);
  const fs = selectFs(rawFs);
  if (location === undefined || fs === undefined) return { ok: false, error: "cache-unavailable" };
  let tmp: string | undefined;
  try {
    const envelope = { format: CACHE_FORMAT, binding: bindingCopy(binding), config: sanitizeShared(shared) };
    const data = `${JSON.stringify(envelope, null, 2)}\n`;
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

/**
 * Reads the cached shared config, accepting it only when it is bound to the current settings.
 * @param binding - the current org, project, repo, path and branch from cacheBindingOf.
 * @param homeFn - a function returning the absolute home directory.
 * @param rawFs - an injected file system, or undefined for the real one.
 * @returns ok with the cached config, or not ok with a fixed code.
 * Codes: cache-unavailable, -missing, -unreadable, -invalid, -outdated and -mismatch; never cache-skipped.
 * Invariants: never throws; fail-closed; the file must be a regular file of at most 2 MiB; shape checks
 *   come before the binding comparison (see checkCacheEnvelope); no path, value or secret is returned.
 * @see ADR-0018 section 3
 * @see contracts/plugin-interface.md section 2f-C
 */
function readCache(binding: CacheBinding, homeFn: unknown, rawFs: unknown): CacheRead {
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
  return checkCacheEnvelope(text, binding);
}

// ==== 13. Logging, fixed messages and hints (ADR-0008, ADR-0020) ====

type HookLog = (level: LogLevel, message: string) => void;

const LOG_REMOTE = "Loaded shared config from Azure DevOps.";
const LOG_MERGE = "Could not apply the shared config; local config left unchanged.";
const LOG_BADCONFIG = "Shared config not applied: the Kilo config is not an object.";
const LOG_NO_SETTINGS =
  "Remote config unavailable (missing-settings) and no usable cache (cache-skipped); continuing with local config only.";
const LOG_UNEXPECTED = "Remote config failed unexpectedly; continuing with local config only.";

const LOG_HINT_NETWORK =
  "Azure DevOps could not be reached from this network: connect to the corporate VPN or ask the platform team to allow your public IP address, then restart Kilo.";
const LOG_HINT_CREDENTIALS =
  "Azure DevOps credentials are missing or were rejected: run az login or replace your PAT and check your access to the shared config repository; if your organisation restricts Azure DevOps by IP address, also connect to the corporate VPN.";

const MAX_LOGGED_PLACEHOLDERS = 20;
const MAX_LOGGED_NAME_CHARS = 200;

/**
 * Creates the fire-and-forget logger that wraps the Kilo client.app.log function.
 * @param input - the Kilo plugin input; only client.app.log is read, and it may be missing.
 * @returns a function taking a level and a message; it does nothing when no logger function exists.
 * Logs: none itself; it forwards exactly the message it is given (service azdo-remote-config).
 * Invariants: never throws: reading the logger, calling it and handling its result are all guarded; the
 *   result is never awaited and its rejection is swallowed; the body holds only service, level and message.
 * @see ADR-0008 section 5
 * @see contracts/plugin-interface.md section 2f-L
 */
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

/**
 * Chooses the fixed hint line for a failure reason.
 * @returns LOG_HINT_NETWORK, LOG_HINT_CREDENTIALS or undefined.
 * Codes: network-unreachable, network-blocked and timeout give the network hint; http-401, http-403 and
 *   auth-unavailable give the credentials hint; every other reason gives none.
 * Invariants: pure and never throws; the text is fixed and never contains a value.
 * @see ADR-0020 section 4
 */
function hintFor(reason: string): string | undefined {
  if (reason === "network-unreachable" || reason === "network-blocked" || reason === "timeout") {
    return LOG_HINT_NETWORK;
  }
  if (reason === "http-401" || reason === "http-403" || reason === "auth-unavailable") {
    return LOG_HINT_CREDENTIALS;
  }
  return undefined;
}

/**
 * Logs the hint for a failure reason, when there is one.
 * @param log - the hook logger.
 * @param reason - the failure reason of the remote step.
 * Logs: at most one warn line, L-HINT-NETWORK or L-HINT-CREDENTIALS.
 * Invariants: never throws; executeHook calls it once, right after the cache-fallback or no-cache line.
 * @see ADR-0020 section 4
 */
function logHint(log: HookLog, reason: string): void {
  const hint = hintFor(reason);
  if (hint !== undefined) log("warn", hint);
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

// ==== 14. Config hook: runConfigHook (ADR-0008) ====

type Acquired = { ok: true; value: Record<string, unknown> } | { ok: false; reason: string };
type HookDeps = Record<string, unknown>;
const HOOK_DEP_KEYS = ["env", "fetch", "runAz", "setTimeout", "clearTimeout", "homedir", "readFile", "fs"] as const;

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

/**
 * Fetches the shared config from Azure DevOps and validates its text: the one network step of the hook.
 * @param settings - the resolved settings from resolveSettings.
 * @param deps - the hook seams; only fetch, env, runAz, setTimeout and clearTimeout are passed on.
 * @returns ok with the validated plain-object config, or not ok with a fixed reason string.
 * Codes: those of fetchRemoteConfig (contracts/plugin-interface.md section 2e) and, from validateShared,
 *   invalid-jsonc and invalid-shape.
 * Invariants: calls fetchRemoteConfig exactly once and never throws, because both collaborators contain
 *   their failures; the reason never holds a value, URL or secret.
 * @see ADR-0008 section 2
 * @see contracts/plugin-interface.md section 2f
 */
async function acquireRemote(settings: unknown, deps: HookDeps): Promise<Acquired> {
  const fetched = await fetchRemoteConfig(
    settings,
    pickDeps(deps, ["fetch", "env", "runAz", "setTimeout", "clearTimeout"]),
  );
  if (!fetched.ok) return { ok: false, reason: fetched.error };
  const checked = validateShared(fetched.text);
  return checked.ok ? checked : { ok: false, reason: checked.error };
}

/**
 * Performs the hook flow in order: settings, one fetch, cache write or fallback, merge.
 * @param log - the fire-and-forget logger from makeLogger.
 * @param options - the raw plugin options for resolveSettings.
 * @param config - the Kilo config; when it is not a plain object only LOG_BADCONFIG is logged.
 * @param deps - the already filtered hook seams (HookDeps).
 * Logs: L-BADCONFIG; L-SET; L-MISSING and LOG_NO_SETTINGS (L-NONE with missing-settings and cache-skipped)
 *   before any fetch or cache read; L-REMOTE and, on a failed cache write, L-CACHE-WRITE; on a failed fetch
 *   L-CACHE or L-NONE, each followed by its hint; then L-UNRESOLVED, L-APPLIED or LOG_MERGE (L-MERGE).
 * Invariants: at most one remote fetch per run; a validated remote config refreshes the cache and is used;
 *   the cache is read only after a failed fetch and used only when its binding equals the current settings;
 *   placeholders are resolved after the source is chosen and the merge is transactional (applyShared). It
 *   may reject only when a collaborator throws unexpectedly; runConfigHook catches that.
 * @see ADR-0008 section 2
 * @see ADR-0018 section 5
 * @see ADR-0020 section 4
 * @see contracts/plugin-interface.md section 2f-L
 */
async function executeHook(log: HookLog, options: unknown, config: unknown, deps: HookDeps): Promise<void> {
  if (!isPlainObject(config)) {
    log("error", LOG_BADCONFIG);
    return;
  }
  const { settings, missing, warnings } = resolveSettings(options, pickDeps(deps, ["env"]));
  for (const warning of warnings) log("warn", warning);
  const binding = cacheBindingOf(settings);
  if (missing.length > 0 || binding === undefined) {
    if (missing.length > 0) log("warn", `Remote config skipped: missing required settings: ${missing.join(", ")}.`);
    log("error", LOG_NO_SETTINGS);
    return;
  }
  const remote = await acquireRemote(settings, deps);
  const home = deps.homedir ?? homedir;
  let shared: Record<string, unknown>;
  let source: "remote" | "cache";
  if (remote.ok) {
    log("info", LOG_REMOTE);
    const written = writeCache(remote.value, binding, home, deps.fs);
    if (!written.ok) log("warn", `Could not update the config cache (${written.error}).`);
    shared = remote.value;
    source = "remote";
  } else {
    const cached = readCache(binding, home, deps.fs);
    if (!cached.ok) {
      log(
        "error",
        `Remote config unavailable (${remote.reason}) and no usable cache (${cached.error}); continuing with local config only.`,
      );
      logHint(log, remote.reason);
      return;
    }
    log("warn", `Remote config unavailable (${remote.reason}); using cached config.`);
    logHint(log, remote.reason);
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

/**
 * Runs the config hook once per Kilo start: settings, fetch, cache fallback, merge.
 * @param input - the Kilo plugin input; only its optional client.app.log is used, through makeLogger.
 * @param options - the raw plugin options, passed on to resolveSettings.
 * @param config - the Kilo config object; it is changed in place only through applyShared.
 * @param deps - optional injected seams (the HOOK_DEP_KEYS); other keys are ignored.
 * @returns a promise that always resolves, with no value.
 * Logs: the fixed LOG_* constants and messages L-SET, L-MISSING, L-REMOTE, L-CACHE-WRITE, L-CACHE, L-NONE,
 *   L-UNRESOLVED, L-APPLIED, L-MERGE, L-BADCONFIG, L-UNEXPECTED and the two hints of contract 2f-L.
 * Invariants: never rejects (FR-10): an unexpected throw from executeHook is caught and logged as
 *   LOG_UNEXPECTED; for ordinary objects every failure leaves the config unchanged or fully merged (the
 *   rollback is best-effort); no secret, URL, host or config value appears in any log (AC-9); the only
 *   config-derived log text is the sanitised placeholder NAMES of L-UNRESOLVED, never their values.
 * @see ADR-0008 section 7
 * @see contracts/plugin-interface.md section 2f
 */
async function runConfigHook(input: unknown, options: unknown, config: unknown, deps?: unknown): Promise<void> {
  const log = makeLogger(input);
  try {
    await executeHook(log, options, config, readHookDeps(deps));
  } catch {
    log("error", LOG_UNEXPECTED);
  }
}

// ==== 15. Exports: __internals, server and default export (ADR-0002) ====

/**
 * Test and validator seam that exposes exactly six functions of this module.
 * Invariants: the keys are parseJsonc, resolvePlaceholders, mergeConfig, resolveSettings, fetchRemoteConfig
 *   and runConfigHook; there is no server key and no other function is exported by name.
 * @see ADR-0002
 * @see contracts/plugin-interface.md section 2
 */
export const __internals = {
  parseJsonc,
  resolvePlaceholders,
  mergeConfig,
  resolveSettings,
  fetchRemoteConfig,
  runConfigHook,
};

/**
 * Plugin entry point: builds the hooks whose config hook applies the remote config.
 * @param input - the Kilo plugin input; only used by the logger (client.app.log).
 * @param options - the raw plugin options from the plugin tuple; validated later by resolveSettings.
 * @returns a promise of a Hooks object whose config hook delegates to runConfigHook.
 * Invariants: does no I/O itself (all work happens inside the config hook); the hook it returns never
 *   rejects (FR-10); it is the server of the default export and is not exported by name (ADR-0002).
 * @see ADR-0002
 * @see contracts/plugin-interface.md section 3
 */
const AzdoRemoteConfig: PluginServer = async (input, options) => {
  return { config: (config) => runConfigHook(input, options, config) };
};

export default { id: PLUGIN_ID, server: AzdoRemoteConfig };
