// azdo-remote-config: Kilo plugin that applies a remote Azure DevOps config.
// Single file, zero runtime dependencies (FR-11). See docs/architecture/ADR-0001-tech-stack.md
// and ADR-0002-plugin-module-shape.md, ADR-0003, ADR-0004. The config hook is still a no-op;
// the JSONC parser and the placeholder resolver are helpers only (not wired yet).

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

/** Test/validator seam. Never has a `server` key and never holds the entry point. */
export const __internals = { parseJsonc, resolvePlaceholders };

const AzdoRemoteConfig: PluginServer = async () => {
  return { config: async () => {} };
};

export default { id: PLUGIN_ID, server: AzdoRemoteConfig };
