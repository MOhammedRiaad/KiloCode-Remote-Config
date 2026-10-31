// Pure validation rules for the shared Kilo config (ADR-0010, contracts/validator-cli.md).
// Findings never contain values from the input: only fixed messages and JSON paths.
import { readFileSync } from "node:fs";
import { __internals } from "../plugin/azdo-remote-config.ts";

export type Severity = "error" | "warning";
export type RuleId =
  | "file-too-large"
  | "invalid-encoding"
  | "invalid-jsonc"
  | "root-not-object"
  | "too-deep"
  | "prototype-key"
  | "api-key"
  | "secret-pattern"
  | "schema-type"
  | "base-url-host"
  | "prototype-member-name"
  | "file-placeholder-unresolvable"
  | "plugin-ignored";
export interface Finding {
  severity: Severity;
  rule: RuleId;
  location: string;
  message: string;
}
export type SchemaType = "object" | "array" | "string" | "number" | "boolean";
export interface SchemaRule {
  path: string;
  type: SchemaType;
}
export interface SchemaSubset {
  kiloVersionRange: string;
  source: string;
  rules: readonly SchemaRule[];
}
export interface ValidateOptions {
  allowedHosts?: ReadonlySet<string>;
  schema?: SchemaSubset;
}

export const MAX_FILE_BYTES = 1048576;
export const MAX_DEPTH = 64;
export const MAX_PRINTED_FINDINGS = 200;
export const SECRET_PATTERN: RegExp = /sk-bf-[a-z0-9]/i;

const MAX_KEY_CHARS = 200;
const PROBE_HOME = "/probe-home";
const SCHEMA_TYPES: readonly string[] = ["object", "array", "string", "number", "boolean"];
const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);
const PROTOTYPE_MEMBERS: ReadonlySet<string> = new Set([
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "toString",
  "valueOf",
]);
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const HOST_ENTRY = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

type Segments = readonly (string | number)[];
type PlainObject = Record<string, unknown>;

// ---- Locations ----

function sanitize(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out += code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? "?" : text.charAt(i);
  }
  return out;
}

function renderKey(key: string): string {
  if (SECRET_PATTERN.test(key)) return "[<redacted>]";
  const cut = key.length > MAX_KEY_CHARS;
  const clean = sanitize(cut ? key.slice(0, MAX_KEY_CHARS) : key);
  if (!cut && IDENTIFIER.test(clean)) return `.${clean}`;
  return `[${JSON.stringify(cut ? `${clean}...` : clean)}]`;
}

export function formatLocation(segments: Segments): string {
  if (segments.length === 0) return "(root)";
  let out = "";
  for (const segment of segments) {
    out += typeof segment === "number" ? `[${segment}]` : renderKey(segment);
  }
  return out.startsWith(".") ? out.slice(1) : out;
}

// ---- Helpers ----

function isObjectLike(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownValue(obj: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(obj, key)?.value;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function finding(severity: Severity, rule: RuleId, location: string, message: string): Finding {
  return { severity, rule, location, message };
}

function error(rule: RuleId, location: string, message: string): Finding {
  return finding("error", rule, location, message);
}

// ---- Schema subset ----

let cachedSchema: SchemaSubset | undefined;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function assertSchema(data: unknown): SchemaSubset {
  if (!isObjectLike(data)) throw new Error("schema subset: root must be an object");
  if (!nonEmptyString(data.kiloVersionRange) || !nonEmptyString(data.source)) {
    throw new Error("schema subset: kiloVersionRange and source are required");
  }
  const rules = data.rules;
  if (!Array.isArray(rules)) throw new Error("schema subset: rules must be an array");
  for (const rule of rules) {
    if (!isObjectLike(rule) || !nonEmptyString(rule.path) || !SCHEMA_TYPES.includes(String(rule.type))) {
      throw new Error("schema subset: malformed rule");
    }
  }
  return data as unknown as SchemaSubset;
}

export function loadSchemaSubset(): SchemaSubset {
  if (cachedSchema) return cachedSchema;
  const raw = readFileSync(new URL("./kilo-schema-subset.json", import.meta.url), "utf8");
  cachedSchema = assertSchema(JSON.parse(raw));
  return cachedSchema;
}

function typeMatches(value: unknown, type: SchemaType): boolean {
  if (type === "object") return isObjectLike(value);
  if (type === "array") return Array.isArray(value);
  return typeof value === type;
}

function collectMatches(
  value: unknown,
  parts: readonly string[],
  index: number,
  path: readonly string[],
  out: { value: unknown; path: readonly string[] }[],
): void {
  if (index === parts.length) {
    out.push({ value, path });
    return;
  }
  if (!isObjectLike(value)) return;
  const part = parts[index]!;
  const keys = part === "*" ? Object.keys(value) : hasOwn(value, part) ? [part] : [];
  for (const key of keys) collectMatches(ownValue(value, key), parts, index + 1, [...path, key], out);
}

function schemaFindings(root: unknown, schema: SchemaSubset): Finding[] {
  const findings: Finding[] = [];
  for (const rule of schema.rules) {
    const matches: { value: unknown; path: readonly string[] }[] = [];
    collectMatches(root, rule.path.split("."), 0, [], matches);
    for (const match of matches) {
      if (!typeMatches(match.value, rule.type)) {
        findings.push(error("schema-type", formatLocation(match.path), `expected ${rule.type}`));
      }
    }
  }
  return findings;
}

// ---- Structure checks ----

function exceedsDepth(root: unknown): boolean {
  const stack: { node: unknown; level: number }[] = [{ node: root, level: 0 }];
  while (stack.length > 0) {
    const { node, level } = stack.pop()!;
    if (typeof node !== "object" || node === null) continue;
    if (level >= MAX_DEPTH) return true;
    const children = Array.isArray(node)
      ? node
      : Object.keys(node).map((key) => ownValue(node, key));
    for (const child of children) stack.push({ node: child, level: level + 1 });
  }
  return false;
}

function placeholderFindings(value: string, location: string): Finding[] {
  if (!value.includes("{file:")) return [];
  const { unresolved } = __internals.resolvePlaceholders(value, {
    env: {},
    homedir: () => PROBE_HOME,
    readFile: () => "probe",
  });
  return unresolved
    .filter((entry) => entry.startsWith("file:"))
    .map(() =>
      finding(
        "warning",
        "file-placeholder-unresolvable",
        location,
        "{file:} placeholder will never resolve (use ~/ or an absolute path)",
      ),
    );
}

function keyFindings(key: string, location: string): Finding[] {
  const out: Finding[] = [];
  if (PROTOTYPE_KEYS.has(key)) out.push(error("prototype-key", location, "key is not allowed (the plugin drops it)"));
  if (key.toLowerCase() === "apikey") out.push(error("api-key", location, "apiKey must never be in the shared config"));
  if (SECRET_PATTERN.test(key)) out.push(error("secret-pattern", location, "key matches a secret pattern"));
  if (PROTOTYPE_MEMBERS.has(key)) {
    out.push(finding("warning", "prototype-member-name", location, "key shadows an Object.prototype member"));
  }
  return out;
}

function valueFindings(value: string, location: string): Finding[] {
  const out: Finding[] = [];
  if (SECRET_PATTERN.test(value)) out.push(error("secret-pattern", location, "value matches a secret pattern"));
  out.push(...placeholderFindings(value, location));
  return out;
}

function walkTree(node: unknown, segments: Segments, out: Finding[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkChild(item, [...segments, i], out));
    return;
  }
  if (!isObjectLike(node)) return;
  for (const key of Object.keys(node)) {
    const path = [...segments, key];
    out.push(...keyFindings(key, formatLocation(path)));
    walkChild(ownValue(node, key), path, out);
  }
}

function walkChild(value: unknown, path: Segments, out: Finding[]): void {
  if (typeof value === "string") out.push(...valueFindings(value, formatLocation(path)));
  else walkTree(value, path, out);
}

function hostAllowed(value: unknown, allowed: ReadonlySet<string>): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" && allowed.has(url.hostname);
  } catch {
    return false;
  }
}

function baseUrlFindings(root: PlainObject, allowed: ReadonlySet<string>): Finding[] {
  const out: Finding[] = [];
  const providers = hasOwn(root, "provider") ? ownValue(root, "provider") : undefined;
  if (!isObjectLike(providers)) return out;
  for (const id of Object.keys(providers)) {
    const provider = ownValue(providers, id);
    const options = isObjectLike(provider) && hasOwn(provider, "options") ? ownValue(provider, "options") : undefined;
    if (!isObjectLike(options) || !hasOwn(options, "baseURL")) continue;
    if (!hostAllowed(ownValue(options, "baseURL"), allowed)) {
      out.push(
        error(
          "base-url-host",
          formatLocation(["provider", id, "options", "baseURL"]),
          "baseURL must be an https URL on an allowed host",
        ),
      );
    }
  }
  return out;
}

function textSecretFindings(text: string): Finding[] {
  const out: Finding[] = [];
  text.split(/\r\n|\n|\r/).forEach((line, i) => {
    if (SECRET_PATTERN.test(line)) out.push(error("secret-pattern", `line ${i + 1}`, "text matches a secret pattern"));
  });
  return out;
}

function parseError(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  return message.startsWith("Invalid JSONC: ") ? message : "Invalid JSONC: malformed JSON";
}

function structureFindings(root: unknown, options: ValidateOptions): Finding[] {
  if (!isObjectLike(root)) return [error("root-not-object", "(root)", "root must be a JSON object")];
  if (exceedsDepth(root)) {
    return [error("too-deep", "(root)", "config is nested too deeply (64 levels or more)")];
  }
  const out: Finding[] = [];
  if (hasOwn(root, "plugin")) {
    out.push(finding("warning", "plugin-ignored", "plugin", "top-level plugin is ignored by the merge"));
  }
  walkTree(root, [], out);
  out.push(...schemaFindings(root, options.schema ?? loadSchemaSubset()));
  if (options.allowedHosts) out.push(...baseUrlFindings(root, options.allowedHosts));
  return out;
}

export function validateConfigText(text: string, options: ValidateOptions = {}): Finding[] {
  const findings: Finding[] = [];
  let root: unknown;
  let parsed = false;
  try {
    root = __internals.parseJsonc(text);
    parsed = true;
  } catch (err) {
    findings.push(error("invalid-jsonc", "(root)", parseError(err)));
  }
  if (parsed) findings.push(...structureFindings(root, options));
  findings.push(...textSecretFindings(text));
  return findings;
}

export function fileTooLargeFinding(): Finding {
  return error("file-too-large", "(root)", "file is larger than 1 MiB");
}

export function validateConfigBytes(bytes: Uint8Array, options: ValidateOptions = {}): Finding[] {
  if (bytes.byteLength > MAX_FILE_BYTES) return [fileTooLargeFinding()];
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return [error("invalid-encoding", "(root)", "file is not valid UTF-8")];
  }
  return validateConfigText(text, options);
}

export function parseAllowedHosts(list: string): Set<string> | undefined {
  const hosts = list
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
  if (hosts.length === 0 || !hosts.every((host) => HOST_ENTRY.test(host))) return undefined;
  return new Set(hosts);
}
