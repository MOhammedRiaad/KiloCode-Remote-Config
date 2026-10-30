import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import plugin, * as mod from "../../plugin/azdo-remote-config.ts";
import type { KiloConfig } from "../../plugin/azdo-remote-config.ts";

function makeInput() {
  const calls: unknown[] = [];
  const input = {
    client: { app: { log: (args: unknown) => void calls.push(args) } },
    directory: tmpdir(),
    worktree: tmpdir(),
  };
  return { input, calls };
}

function sampleConfig(): KiloConfig {
  return {
    provider: { example: { options: { baseURL: "https://example.invalid/v1" } } },
    models: { default: "example/model" },
    agent: { build: { prompt: "hello", tools: { bash: true } } },
    plugin: [["azdo-remote-config", { org: "o" }]],
  };
}

test("plugin has id and server function", () => {
  assert.equal(plugin.id, "azdo-remote-config");
  assert.equal(mod.PLUGIN_ID, "azdo-remote-config");
  assert.equal(typeof plugin.server, "function");
});

test("server returns a config hook", async () => {
  const hooks = await plugin.server(makeInput().input, {});
  assert.equal(typeof hooks.config, "function");
});

test("server resolves for empty input and undefined options", async () => {
  const hooks = await plugin.server({}, undefined);
  assert.equal(typeof hooks.config, "function");
});

test("server resolves for non-object options", async () => {
  const hooks = await plugin.server({}, null as unknown as undefined);
  assert.equal(typeof hooks.config, "function");
});

test("config hook leaves the config deep-equal and the same reference", async () => {
  const hooks = await plugin.server(makeInput().input, {});
  const cfg = sampleConfig();
  const before = structuredClone(cfg);
  const ref = cfg;
  await hooks.config(cfg);
  assert.deepEqual(cfg, before);
  assert.equal(cfg, ref);
});

test("stub never logs", async () => {
  const { input, calls } = makeInput();
  const hooks = await plugin.server(input, {});
  await hooks.config(sampleConfig());
  assert.equal(calls.length, 0);
});

test("no named export is a function and __internals has no server key", () => {
  for (const [name, value] of Object.entries(mod)) {
    if (name === "default") continue;
    assert.notEqual(typeof value, "function", `export ${name} must not be a function`);
  }
  assert.equal(typeof mod.__internals, "object");
  assert.equal("server" in mod.__internals, false);
});

test("SUPPORTED_KILO_RANGE is fixed", () => {
  assert.equal(mod.SUPPORTED_KILO_RANGE, ">=7.2.0 <8.0.0");
});
