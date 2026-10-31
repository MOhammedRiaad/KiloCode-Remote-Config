import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SUPPORTED_KILO_RANGE } from "../../plugin/azdo-remote-config.ts";
import { loadSchemaSubset, validateConfigText } from "../../validator/kilo-config-rules.ts";
import { runOn } from "./helpers.ts";

const schemaFile = new URL("../../validator/kilo-schema-subset.json", import.meta.url);

test("AC5: subset file exists and is pinned to the supported Kilo range", () => {
  const raw = JSON.parse(readFileSync(schemaFile, "utf8"));
  assert.equal(raw.kiloVersionRange, SUPPORTED_KILO_RANGE);
  assert.equal(loadSchemaSubset().kiloVersionRange, SUPPORTED_KILO_RANGE);
});

test("AC5: every rule is well formed", () => {
  const types = ["object", "array", "string", "number", "boolean"];
  for (const rule of loadSchemaSubset().rules) {
    assert.ok(rule.path.length > 0);
    assert.ok(types.includes(rule.type));
  }
});

const violations: [string, string, string][] = [
  ['{"provider": []}', "provider", "expected object"],
  ['{"provider": "x"}', "provider", "expected object"],
  ['{"provider": {"bifrost": 1}}', "provider.bifrost", "expected object"],
  ['{"provider": {"bifrost": {"options": "x"}}}', "provider.bifrost.options", "expected object"],
  ['{"provider": {"bifrost": {"models": []}}}', "provider.bifrost.models", "expected object"],
  ['{"model": 5}', "model", "expected string"],
  ['{"instructions": {}}', "instructions", "expected array"],
];

for (const [json, path, message] of violations) {
  test(`AC5: schema violation ${json}`, () => {
    const hit = validateConfigText(json).filter((f) => f.rule === "schema-type");
    assert.deepEqual(
      hit.map((f) => [f.location, f.message]),
      [[path, message]],
    );
    const r = runOn(json);
    assert.equal(r.status, 1, r.all);
    assert.match(r.stdout, new RegExp(`schema-type at ${path.replace(/\./g, "\.")}:`));
  });
}

test("AC5: unknown and missing keys are not errors", () => {
  const findings = validateConfigText('{"somethingNew": {"a": 1}, "provider": {"x": {"extra": true}}}');
  assert.deepEqual(findings, []);
  assert.deepEqual(validateConfigText("{}"), []);
});

test("AC5: wildcard does not descend into non-objects", () => {
  assert.deepEqual(validateConfigText('{"provider": {"bifrost": {"models": {"m": 1}}}}').map((f) => f.location), [
    'provider.bifrost.models.m',
  ]);
});
