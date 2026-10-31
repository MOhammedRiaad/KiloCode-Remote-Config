import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { __internals } from "../../plugin/azdo-remote-config.ts";
import { SECRET_PATTERN, validateConfigText } from "../../validator/kilo-config-rules.ts";
import { backendRoot, examplePath, FAKE_SECRET, SECRET_TAIL } from "../validator/helpers.ts";

const templatePath = join(backendRoot, "personal-config", "kilo.jsonc");
const raw = readFileSync(templatePath, "utf8");
const OPTION_KEYS = ["branch", "mode", "org", "path", "project", "repo"];

function parseTemplate(): Record<string, any> {
  return __internals.parseJsonc(raw) as Record<string, any>;
}

function pluginOptions(cfg: Record<string, any>): Record<string, any> {
  return cfg.plugin[0][1] as Record<string, any>;
}

function apiKeyOf(cfg: Record<string, any>): string {
  return cfg.provider.bifrost.options.apiKey as string;
}

test("AC1: template parses and has the expected root keys and schema", () => {
  const cfg = parseTemplate();
  assert.equal(typeof cfg, "object");
  assert.ok(cfg !== null && !Array.isArray(cfg));
  assert.deepEqual(Object.keys(cfg).sort(), ["$schema", "plugin", "provider"]);
  assert.equal(cfg["$schema"], "https://app.kilo.ai/config.json");
});

test("AC1: comments name the global path and warn about project directories", () => {
  assert.match(raw, /^[ \t]*\/\/.*~\/\.config\/kilo\/kilo\.jsonc/m);
  assert.match(raw, /^[ \t]*\/\/.*project directory/im);
});

test("AC2: plugin entry is the tuple with exactly the six options and no pat", () => {
  const cfg = parseTemplate();
  assert.equal(cfg.plugin.length, 1);
  const entry = cfg.plugin[0] as unknown[];
  assert.ok(Array.isArray(entry));
  assert.equal(entry.length, 2);
  assert.equal(entry[0], "./azdo/azdo-remote-config.ts");
  const opts = pluginOptions(cfg);
  assert.deepEqual(Object.keys(opts).sort(), OPTION_KEYS);
  assert.equal("pat" in opts, false);
  for (const v of Object.values(opts)) {
    assert.equal(typeof v, "string");
    assert.ok((v as string).length > 0);
  }
  assert.ok((opts.path as string).startsWith("/"));
  assert.ok(["defaults", "enforce"].includes(opts.mode as string));
});

test("AC3: plugin settings resolve with nothing missing and no warnings", () => {
  const opts = pluginOptions(parseTemplate());
  const r = __internals.resolveSettings(opts, { env: {} });
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.warnings, []);
  for (const key of OPTION_KEYS) {
    assert.equal((r.settings as unknown as Record<string, unknown>)[key], opts[key], key);
  }
});

test("AC4: provider holds only an apiKey placeholder that is not secret-shaped", () => {
  const cfg = parseTemplate();
  assert.deepEqual(Object.keys(cfg.provider), ["bifrost"]);
  assert.deepEqual(Object.keys(cfg.provider.bifrost), ["options"]);
  assert.deepEqual(Object.keys(cfg.provider.bifrost.options), ["apiKey"]);
  const apiKey = apiKeyOf(cfg);
  assert.equal(typeof apiKey, "string");
  assert.ok(apiKey.startsWith("sk-bf-"));
  assert.equal(SECRET_PATTERN.test(apiKey), false);
});

test("AC5: validator reports no secret-pattern finding for the template", () => {
  const findings = validateConfigText(raw);
  assert.equal(findings.some((f) => f.rule === "secret-pattern"), false);
  const pick = (severity: string) =>
    findings.filter((f) => f.severity === severity).map((f) => ({ rule: f.rule, location: f.location }));
  assert.deepEqual(pick("error"), [{ rule: "api-key", location: "provider.bifrost.options.apiKey" }]);
  assert.deepEqual(pick("warning"), [{ rule: "plugin-ignored", location: "plugin" }]);
});

test("AC5: positive control - a real-looking key is flagged without echoing its value", () => {
  const placeholder = apiKeyOf(parseTemplate());
  const replaced = raw.replace(placeholder, FAKE_SECRET);
  assert.notEqual(replaced, raw);
  const findings = validateConfigText(replaced);
  assert.ok(findings.some((f) => f.rule === "secret-pattern"));
  for (const f of findings) {
    for (const text of [f.rule, f.location, f.message]) {
      assert.equal(text.includes(SECRET_TAIL), false);
    }
  }
});

for (const mode of ["defaults", "enforce"]) {
  test(`AC6: merging the shared config (${mode}) keeps apiKey and plugin`, () => {
    const local = parseTemplate();
    const shared = __internals.parseJsonc(readFileSync(examplePath, "utf8")) as Record<string, any>;
    const placeholder = apiKeyOf(local);
    const pluginBefore = structuredClone(local.plugin);
    const schemaBefore = structuredClone(local["$schema"]);
    __internals.mergeConfig(local, shared, mode);
    const options = local.provider.bifrost.options as Record<string, any>;
    assert.equal(options.apiKey, placeholder);
    assert.equal(options.baseURL, shared.provider.bifrost.options.baseURL);
    const models = Object.keys(local.provider.bifrost.models as Record<string, unknown>);
    assert.ok(models.includes("azure/gpt-5"));
    assert.ok(models.includes("azure/gpt-5-mini"));
    assert.deepEqual(local.plugin, pluginBefore);
    assert.deepEqual(local["$schema"], schemaBefore);
  });
}
