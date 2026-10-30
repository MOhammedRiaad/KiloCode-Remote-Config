// azdo-remote-config: Kilo plugin that applies a remote Azure DevOps config.
// Single file, zero runtime dependencies (FR-11). See docs/architecture/ADR-0001-tech-stack.md
// and ADR-0002-plugin-module-shape.md, ADR-0003, ADR-0004, ADR-0005, ADR-0006. The config hook is
// still a no-op; the JSONC parser, the placeholder resolver, the config merge and the settings
// resolver (options, KILO_AZDO_* env, defaults) are helpers only (not wired yet).

import { readFileSync, statSync } from "node:fs";
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
function mergeInto(target: Record<string, unknown>, source: Record<string, unknown>, enforce: boolean): void {
  for (const key of Object.keys(source)) {
    const incoming = source[key];
    const local = hasOwn(target, key) ? target[key] : undefined;
    if (local === undefined) {
      defineOwn(target, key, incoming);
    } else if (isPlainObject(local) && isPlainObject(incoming)) {
      mergeInto(local, incoming, enforce);
    } else if (enforce && !containsApiKey(local, 0)) {
      defineOwn(target, key, incoming);
    }
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
  if (hasControlChar(trimmed) || hasAnyChar(trimmed, "/\\?#%")) return undefined;
  return trimmed === "." || trimmed === ".." ? undefined : trimmed;
}

function acceptBranch(trimmed: string): string | undefined {
  if (hasControlChar(trimmed) || hasAnyChar(trimmed, " \\?#%")) return undefined;
  if (trimmed.includes("..") || trimmed.includes("//")) return undefined;
  return trimmed.startsWith("/") || trimmed.endsWith("/") ? undefined : trimmed;
}

function acceptPath(trimmed: string): string | undefined {
  if (hasControlChar(trimmed) || hasAnyChar(trimmed, "\\?#%")) return undefined;
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

/** Test/validator seam. Never has a `server` key and never holds the entry point. */
export const __internals = { parseJsonc, resolvePlaceholders, mergeConfig, resolveSettings };

const AzdoRemoteConfig: PluginServer = async () => {
  return { config: async () => {} };
};

export default { id: PLUGIN_ID, server: AzdoRemoteConfig };
