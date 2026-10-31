import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_FILE_BYTES,
  formatLocation,
  parseAllowedHosts,
  validateConfigBytes,
  validateConfigText,
  type Finding,
} from "../../validator/kilo-config-rules.ts";
import { FAKE_SECRET, SECRET_TAIL } from "./helpers.ts";

const rules = (fs: Finding[]) => fs.map((f) => f.rule);

test("formatLocation renders identifiers, bracket keys and indices", () => {
  assert.equal(formatLocation([]), "(root)");
  assert.equal(formatLocation(["provider", "bifrost", "options"]), "provider.bifrost.options");
  assert.equal(formatLocation(["provider", "azure/gpt-5"]), 'provider["azure/gpt-5"]');
  assert.equal(formatLocation(["list", 0, "apiKey"]), "list[0].apiKey");
  assert.equal(formatLocation(["a", `x${FAKE_SECRET}`]), "a[<redacted>]");
});

test("formatLocation sanitises control characters and cuts long keys", () => {
  assert.equal(formatLocation(["a\nb"]), '["a?b"]');
  assert.equal(formatLocation(["k".repeat(300)]), `["${"k".repeat(200)}..."]`);
});

test("validateConfigText never throws on odd input", () => {
  for (const input of ["", "﻿", "{", "[", "null", '"x"', "/*", '{"a":']) {
    assert.doesNotThrow(() => validateConfigText(input), input);
  }
  assert.ok(rules(validateConfigText("")).includes("invalid-jsonc"));
});

function nested(n: number): string {
  return `{"a":${"[".repeat(n)}${"]".repeat(n)}}`;
}

test("depth boundary: 63 nested arrays allowed, 64 too deep", () => {
  assert.equal(rules(validateConfigText(nested(63))).includes("too-deep"), false);
  assert.ok(rules(validateConfigText(nested(64))).includes("too-deep"));
});

test("prototype pollution is not possible and Object.prototype is unchanged", () => {
  const before = Object.getOwnPropertyNames(Object.prototype).sort();
  const f = validateConfigText('{"__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}}}');
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), before);
  assert.deepEqual(
    f.filter((x) => x.rule === "prototype-key").map((x) => x.location),
    ["__proto__", "constructor", "constructor.prototype"],
  );
});

test("JSON-escaped secret is caught by the tree check", () => {
  const escaped = FAKE_SECRET.replace("-", "\\u002d");
  const f = validateConfigText(`{"a": "${escaped}"}`);
  assert.ok(f.some((x) => x.rule === "secret-pattern" && x.location === "a"));
});

test("placeholder-like text is not flagged as a secret", () => {
  assert.deepEqual(validateConfigText('{"a": "sk-bf-...", "b": "sk-bf-<your-key>"}'), []);
});

test("no finding contains input values", () => {
  const input = `{"apiKey": "${FAKE_SECRET}", "x": {"${FAKE_SECRET}": "{file:rel/${SECRET_TAIL}}"}} // ${FAKE_SECRET}`;
  const f = validateConfigText(input);
  assert.ok(f.length >= 4);
  for (const x of f) assert.ok(!(x.message + x.location).includes(SECRET_TAIL));
});

test("secret text scan still runs after invalid-jsonc", () => {
  const f = validateConfigText(`{ "a": \n // ${FAKE_SECRET}\n`);
  assert.deepEqual(rules(f), ["invalid-jsonc", "secret-pattern"]);
  assert.equal(f[1]!.location, "line 2");
});

test("parseAllowedHosts", () => {
  assert.deepEqual([...parseAllowedHosts("Bifrost.Example.com, b.io ,,")!].sort(), ["b.io", "bifrost.example.com"]);
  assert.equal(parseAllowedHosts(""), undefined);
  assert.equal(parseAllowedHosts(" , "), undefined);
  assert.equal(parseAllowedHosts("bad host"), undefined);
  assert.equal(parseAllowedHosts("ok.com,-bad"), undefined);
  assert.equal(parseAllowedHosts("a/b"), undefined);
});

test("validateConfigBytes: size cap and strict UTF-8", () => {
  assert.deepEqual(rules(validateConfigBytes(new Uint8Array(MAX_FILE_BYTES + 1))), ["file-too-large"]);
  assert.deepEqual(rules(validateConfigBytes(new Uint8Array([0x7b, 0xff, 0x7d]))), ["invalid-encoding"]);
  assert.deepEqual(validateConfigBytes(new TextEncoder().encode("{}")), []);
});
