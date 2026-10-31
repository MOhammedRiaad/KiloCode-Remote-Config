import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import mod, { __internals } from "../../plugin/azdo-remote-config.ts";
import { examplePath, runCli } from "./helpers.ts";

function parsed(): Record<string, any> {
  return __internals.parseJsonc(readFileSync(examplePath, "utf8")) as Record<string, any>;
}

function hasApiKey(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  return Object.entries(node).some(([k, v]) => k.toLowerCase() === "apikey" || hasApiKey(v));
}

test("AC1: example config validates clean", () => {
  const r = runCli([examplePath]);
  assert.equal(r.status, 0, r.all);
  assert.match(r.stdout, /kilo\.jsonc: valid\n/);
  assert.doesNotMatch(r.stdout, /warning/);
});

test("AC1: example config validates clean with the host allowlist", () => {
  const r = runCli(["--allowed-hosts", "bifrost.yourcompany.internal", examplePath]);
  assert.equal(r.status, 0, r.all);
  assert.doesNotMatch(r.stdout, /warning|base-url-host/);
});

test("AC1: example config content", () => {
  const cfg = parsed();
  assert.equal(cfg.provider.bifrost.options.baseURL, "https://bifrost.yourcompany.internal/v1");
  assert.deepEqual(Object.keys(cfg.provider.bifrost.models).sort(), ["azure/gpt-5", "azure/gpt-5-mini"]);
  assert.equal(hasApiKey(cfg), false);
});

test("AC1: example config has comments, a trailing comma, no secret text and no plugin", () => {
  const raw = readFileSync(examplePath, "utf8");
  assert.match(raw, /^\s*\/\//m);
  assert.match(raw, /\/\*[\s\S]*\*\//);
  assert.match(raw, /,[^\n]*\n\s*\}/);
  assert.doesNotMatch(raw, /sk-bf-/i);
  assert.doesNotMatch(raw, /\r/);
  assert.equal("plugin" in parsed(), false);
});

test("AC8: plugin export surface is unchanged", () => {
  assert.deepEqual(Object.keys(mod).sort(), ["id", "server"]);
  assert.deepEqual(Object.keys(__internals).sort(), [
    "fetchRemoteConfig",
    "mergeConfig",
    "parseJsonc",
    "resolvePlaceholders",
    "resolveSettings",
    "runConfigHook",
  ]);
});
