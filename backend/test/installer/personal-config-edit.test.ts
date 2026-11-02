import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { __internals } from "../../plugin/azdo-remote-config.ts";
import {
  PLACEHOLDER_KEY,
  planUpdate,
  refersToAzdoPlugin,
  renderFresh,
  renderUpdated,
  storedApiKey,
  validateInputs,
} from "../../installer/personal-config-edit.ts";
import type { Values } from "../../installer/personal-config-edit.ts";

const template = readFileSync(new URL("../../personal-config/kilo.jsonc", import.meta.url), "utf8");
const parse = (text: string): any => __internals.parseJsonc(text);
const values: Values = { org: "acme", project: "proj", repo: "cfg", path: "/kilo.jsonc", branch: "main", mode: "defaults" };
const entry = ["./azdo/azdo-remote-config.ts", { ...values }];
const FAKE = ["sk-bf", "runtime", "secret"].join("-");

function plan(existing: Record<string, unknown>, key?: string) {
  const result = planUpdate(existing, values, key);
  assert.ok(result.ok, "expected a plan");
  return result;
}

function records(over: Record<string, string> = {}): Record<string, string> {
  return { ...values, apiKey: "", ...over };
}

test("fresh render keeps comments and fills values", () => {
  const text = renderFresh(template, values, FAKE);
  assert.match(text, /^\/\/ Personal Kilo configuration template/);
  assert.match(text, /\/\/ Replace the placeholder/);
  const parsed = parse(text);
  assert.deepEqual(parsed["plugin"], [entry]);
  assert.deepEqual(Object.keys(parse(text)["plugin"][0][1]), ["org", "project", "repo", "path", "branch", "mode"]);
  assert.equal(parsed["provider"].bifrost.options.apiKey, FAKE);
});

test("fresh render without key keeps the placeholder", () => {
  const parsed = parse(renderFresh(template, values, undefined));
  assert.equal(parsed["provider"].bifrost.options.apiKey, PLACEHOLDER_KEY);
});

test("fresh render normalises CRLF and throws on template drift", () => {
  assert.ok(!renderFresh(template.replace(/\n/g, "\r\n"), values, undefined).includes("\r"));
  assert.throws(() => renderFresh(template.replace('"main"', '"dev"'), values, undefined), /template drift/);
});

test("fresh render escapes values safely", () => {
  const tricky = renderFresh(template, values, 'a"b$&c');
  assert.equal(parse(tricky)["provider"].bifrost.options.apiKey, 'a"b$&c');
});

const existing = () => ({
  model: "bifrost/x",
  headers: { a: 1 },
  provider: { other: { x: 1 }, bifrost: { options: { apiKey: "sk-bf-existing", baseURL: "u" } } },
  plugin: [
    "my-other-plugin",
    ["./plugin/azdo-remote-config.ts", { org: "old", pat: "p", timeoutMs: 5 }],
    ["third", {}],
    "file:///x/azdo-remote-config.js",
  ],
});

test("update keeps other settings, collapses azdo entries at the first index", () => {
  const result = plan(existing()).result as Record<string, any>;
  assert.deepEqual(result["plugin"], ["my-other-plugin", entry, ["third", {}]]);
  assert.equal(result["model"], "bifrost/x");
  assert.deepEqual(result["headers"], { a: 1 });
  assert.deepEqual(result["provider"].other, { x: 1 });
  assert.equal(result["provider"].bifrost.options.baseURL, "u");
});

test("update appends when no azdo entry exists and creates plugin when absent", () => {
  assert.deepEqual((plan({ plugin: ["a"] }).result["plugin"] as unknown[]).at(-1), entry);
  assert.deepEqual(plan({}).result["plugin"], [entry]);
});

test("apiKey: kept without key, replaced with key, placeholder when absent", () => {
  assert.equal((plan(existing()).result as any).provider.bifrost.options.apiKey, "sk-bf-existing");
  assert.equal((plan(existing(), FAKE).result as any).provider.bifrost.options.apiKey, FAKE);
  assert.equal((plan({}).result as any).provider.bifrost.options.apiKey, PLACEHOLDER_KEY);
});

test("dropped option names are reported without values", () => {
  const dropped = plan(existing()).droppedOptions;
  assert.deepEqual(dropped, ["pat", "timeoutMs"]);
  assert.ok(!JSON.stringify(dropped).includes('"p"'));
});

test("update is idempotent", () => {
  const first = plan(existing(), FAKE);
  assert.equal(first.changed, true);
  const second = plan(parse(renderUpdated(first.result)), FAKE);
  assert.equal(second.changed, false);
  assert.equal(plan(parse(renderUpdated(first.result))).changed, false);
});

test("renderUpdated writes a header and parseable JSON", () => {
  const text = renderUpdated(plan(existing()).result);
  assert.match(text, /^\/\/ Personal Kilo configuration \(C3\)\. Rewritten by install\.sh/);
  assert.ok(text.endsWith("}\n"));
  assert.deepEqual(parse(text), plan(existing()).result);
});

test("non-object plugin, provider, bifrost and options give errors", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ plugin: {} }, "plugin-not-array"],
    [{ provider: [] }, "provider-not-object"],
    [{ provider: { bifrost: "x" } }, "bifrost-not-object"],
    [{ provider: { bifrost: { options: null } } }, "options-not-object"],
  ];
  for (const [input, error] of cases) assert.deepEqual(planUpdate(input, values, undefined), { ok: false, error });
});

test("planUpdate does not mutate its input", () => {
  const input = existing();
  const clone = structuredClone(input);
  planUpdate(input, values, FAKE);
  assert.deepEqual(input, clone);
});

test("refersToAzdoPlugin matches only azdo-remote-config files", () => {
  for (const yes of ["./azdo/azdo-remote-config.ts", "C:\\x\\azdo-remote-config.mjs", ["azdo-remote-config", {}]]) {
    assert.equal(refersToAzdoPlugin(yes), true);
  }
  for (const no of ["my-azdo-remote-config.ts", "azdo-remote-config.json", 5, null, [1], {}]) {
    assert.equal(refersToAzdoPlugin(no), false);
  }
});

test("validateInputs accepts and normalises", () => {
  const ok = validateInputs(records({ path: "kilo.jsonc", org: " acme " }));
  assert.ok(ok.ok);
  assert.equal(ok.values.path, "/kilo.jsonc");
  assert.equal(ok.values.org, "acme");
  assert.equal(ok.apiKey, undefined);
});

test("validateInputs rejects invalid values without echoing them", () => {
  const cases: Array<[string, string]> = [["org", "a/b"], ["branch", "a..b"], ["mode", "zzz"], ["repo", ""]];
  for (const [name, value] of cases) {
    const result = validateInputs(records({ [name]: value }));
    assert.ok(!result.ok);
    assert.equal(result.name, name);
    if (value !== "") assert.ok(!result.reason.includes(value));
  }
});

test("validateInputs rejects control characters in the key and never leaks it", () => {
  const result = validateInputs(records({ apiKey: `${FAKE}\nx` }));
  assert.ok(!result.ok);
  assert.ok(!JSON.stringify(result).includes(FAKE));
});

test("validateInputs flags an unusual key prefix", () => {
  const unusual = validateInputs(records({ apiKey: "abc" }));
  assert.ok(unusual.ok && unusual.apiKeyLooksUnusual);
  const usual = validateInputs(records({ apiKey: FAKE }));
  assert.ok(usual.ok && !usual.apiKeyLooksUnusual && usual.apiKey === FAKE);
});

test("planUpdate adds no bifrost block when the key already lives in the azurefoundry x-bf-vk header; a supplied key replaces it", () => {
  const existing = { provider: { azurefoundry: { options: { headers: { "x-bf-vk": "sk-bf-old" } } } } };
  const kept = planUpdate(existing, values, undefined);
  assert.equal(kept.ok, true);
  if (!kept.ok) return;
  assert.equal(Object.hasOwn(kept.result["provider"] as object, "bifrost"), false);
  assert.equal(storedApiKey(kept.result), "sk-bf-old");
  const replaced = planUpdate(existing, values, "sk-bf-new");
  assert.equal(replaced.ok, true);
  if (!replaced.ok) return;
  assert.equal(Object.hasOwn(replaced.result["provider"] as object, "bifrost"), false);
  assert.equal(storedApiKey(replaced.result), "sk-bf-new");
  assert.equal(storedApiKey(existing), "sk-bf-old");
});
