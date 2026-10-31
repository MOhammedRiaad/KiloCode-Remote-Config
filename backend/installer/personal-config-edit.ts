// Pure helpers for the bootstrap installer (ADR-0012): input validation, fresh rendering of the
// personal config template and the update of an existing config. No file system access here.
import { isDeepStrictEqual } from "node:util";
import { __internals } from "../plugin/azdo-remote-config.ts";

export const PLACEHOLDER_KEY = "sk-bf-<your-virtual-key>";
export const PLUGIN_SPEC = "./azdo/azdo-remote-config.ts";
export const SETTING_NAMES = ["org", "project", "repo", "path", "branch", "mode"] as const;

export type SettingName = (typeof SETTING_NAMES)[number];
export type Values = Record<SettingName, string>;
type Json = Record<string, unknown>;

export type ValidateResult =
  | { ok: true; values: Values; apiKey: string | undefined; apiKeyLooksUnusual: boolean }
  | { ok: false; name: string; reason: string };

export type UpdateErrorCode =
  | "plugin-not-array"
  | "provider-not-object"
  | "bifrost-not-object"
  | "options-not-object";

export type UpdatePlan =
  | { ok: true; result: Json; changed: boolean; droppedOptions: string[] }
  | { ok: false; error: UpdateErrorCode };

const AZDO_FILE = /^azdo-remote-config(\.(ts|mts|js|mjs))?$/;
const SAFE_OPTION_NAME = /^[A-Za-z0-9_.-]{1,40}$/;
const UPDATED_HEADER =
  "// Personal Kilo configuration (C3). Rewritten by install.sh: comments were not preserved.\n" +
  "// The previous version is saved next to this file as kilo.jsonc.bak-<timestamp>.\n";

export function isPlainObject(value: unknown): value is Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function reasonOf(warning: string): string {
  const at = warning.indexOf(": ");
  return at === -1 ? "value rejected." : warning.slice(at + 2);
}

function validateSetting(name: SettingName, raw: string): { ok: true; value: string } | { ok: false; reason: string } {
  const result = __internals.resolveSettings({ [name]: raw }, { env: {} });
  if (result.warnings.length > 0) return { ok: false, reason: reasonOf(result.warnings[0] ?? "") };
  const value = result.settings[name];
  if (typeof value !== "string" || value === "") return { ok: false, reason: "a non-empty value is required." };
  return { ok: true, value };
}

/** Validates the six settings with the plugin's own rules and the optional key. */
export function validateInputs(records: Record<string, string>): ValidateResult {
  const values = {} as Values;
  for (const name of SETTING_NAMES) {
    const checked = validateSetting(name, records[name] ?? "");
    if (!checked.ok) return { ok: false, name, reason: checked.reason };
    values[name] = checked.value;
  }
  const key = records["apiKey"] ?? "";
  if (hasControlChar(key)) return { ok: false, name: "KILO_BIFROST_KEY", reason: "contains control characters." };
  const apiKey = key === "" ? undefined : key;
  return { ok: true, values, apiKey, apiKeyLooksUnusual: apiKey !== undefined && !apiKey.startsWith("sk-bf-") };
}

function buildEntry(values: Values): unknown[] {
  const options: Json = {};
  for (const name of SETTING_NAMES) options[name] = values[name];
  return [PLUGIN_SPEC, options];
}

function specOf(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry) && typeof entry[0] === "string") return entry[0];
  return undefined;
}

/** True when a plugin entry (string or tuple) points at azdo-remote-config. */
export function refersToAzdoPlugin(entry: unknown): boolean {
  const spec = specOf(entry);
  if (spec === undefined) return false;
  const last = spec.split(/[/\\]/).pop() ?? "";
  return AZDO_FILE.test(last);
}

function replaceOnce(text: string, token: string, replacement: string): string {
  const parts = text.split(token);
  if (parts.length !== 2) throw new Error("template drift");
  return `${parts[0]}${replacement}${parts[1]}`;
}

/** Renders the template with the seven values; throws a fixed error if the template drifted. */
export function renderFresh(templateText: string, values: Values, apiKey: string | undefined): string {
  let text = templateText.replace(/\r\n/g, "\n");
  const expectedKey = apiKey ?? PLACEHOLDER_KEY;
  const pairs: Array<[string, string, string]> = [
    ["org", "contoso", values.org],
    ["project", "platform", values.project],
    ["repo", "kilo-config", values.repo],
    ["path", "/kilo.jsonc", values.path],
    ["branch", "main", values.branch],
    ["mode", "defaults", values.mode],
    ["apiKey", PLACEHOLDER_KEY, expectedKey],
  ];
  for (const [name, original, next] of pairs) {
    text = replaceOnce(text, `"${name}": ${JSON.stringify(original)}`, `"${name}": ${JSON.stringify(next)}`);
  }
  const template = __internals.parseJsonc(templateText);
  const expected = {
    ...(isPlainObject(template) ? template : {}),
    plugin: [buildEntry(values)],
    provider: { bifrost: { options: { apiKey: expectedKey } } },
  };
  if (!isDeepStrictEqual(__internals.parseJsonc(text), expected)) throw new Error("template drift");
  return text;
}

function optionNamesOf(entry: unknown): string[] {
  if (!Array.isArray(entry) || !isPlainObject(entry[1])) return [];
  const known: readonly string[] = SETTING_NAMES;
  return Object.keys(entry[1]).filter((key) => !known.includes(key));
}

function mergePlugins(plugins: unknown[], entry: unknown[]): { list: unknown[]; dropped: string[] } {
  const list: unknown[] = [];
  const dropped: string[] = [];
  let at = -1;
  for (const item of plugins) {
    if (!refersToAzdoPlugin(item)) {
      list.push(item);
      continue;
    }
    if (at === -1) at = list.length;
    for (const name of optionNamesOf(item)) {
      const safe = SAFE_OPTION_NAME.test(name) ? name : "(unprintable name)";
      if (!dropped.includes(safe)) dropped.push(safe);
    }
  }
  list.splice(at === -1 ? list.length : at, 0, entry);
  return { list, dropped };
}

function childObject(parent: Json, key: string): Json | undefined {
  if (!(key in parent)) {
    const created: Json = {};
    parent[key] = created;
    return created;
  }
  const value = parent[key];
  return isPlainObject(value) ? value : undefined;
}

function applyKey(root: Json, apiKey: string | undefined): UpdateErrorCode | undefined {
  const provider = childObject(root, "provider");
  if (provider === undefined) return "provider-not-object";
  const bifrost = childObject(provider, "bifrost");
  if (bifrost === undefined) return "bifrost-not-object";
  const options = childObject(bifrost, "options");
  if (options === undefined) return "options-not-object";
  if (apiKey !== undefined) options["apiKey"] = apiKey;
  else if (!("apiKey" in options)) options["apiKey"] = PLACEHOLDER_KEY;
  return undefined;
}

/** Plans the update of an existing config object without mutating it. */
export function planUpdate(existing: Json, values: Values, apiKey: string | undefined): UpdatePlan {
  const result = structuredClone(existing);
  let dropped: string[] = [];
  if ("plugin" in result) {
    const current = result["plugin"];
    if (!Array.isArray(current)) return { ok: false, error: "plugin-not-array" };
    const merged = mergePlugins(current, buildEntry(values));
    result["plugin"] = merged.list;
    dropped = merged.dropped;
  } else {
    result["plugin"] = [buildEntry(values)];
  }
  const keyError = applyKey(result, apiKey);
  if (keyError !== undefined) return { ok: false, error: keyError };
  return { ok: true, result, changed: !isDeepStrictEqual(result, existing), droppedOptions: dropped };
}

export function renderUpdated(result: Json): string {
  return `${UPDATED_HEADER}${JSON.stringify(result, null, 2)}\n`;
}

/** The apiKey stored in a config object, if any. */
export function storedApiKey(config: Json): unknown {
  const provider = config["provider"];
  const bifrost = isPlainObject(provider) ? provider["bifrost"] : undefined;
  const options = isPlainObject(bifrost) ? bifrost["options"] : undefined;
  return isPlainObject(options) ? options["apiKey"] : undefined;
}
