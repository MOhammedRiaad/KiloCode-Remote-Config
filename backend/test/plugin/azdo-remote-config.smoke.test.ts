import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import plugin, * as mod from "../../plugin/azdo-remote-config.ts";

const PLUGIN_PATH = resolve(fileURLToPath(new URL("../../plugin/azdo-remote-config.ts", import.meta.url)));

function makeInput() {
  return {
    client: { app: { log: (_args: unknown) => undefined } },
    directory: tmpdir(),
    worktree: tmpdir(),
  };
}

test("plugin has id and server function", () => {
  assert.equal(plugin.id, "azdo-remote-config");
  assert.equal(mod.PLUGIN_ID, "azdo-remote-config");
  assert.equal(typeof plugin.server, "function");
});

test("server returns a config hook", async () => {
  const hooks = await plugin.server(makeInput(), {});
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

test("default wiring in a child process: no settings means a skipped fetch and an unchanged config", () => {
  const home = mkdtempSync(join(tmpdir(), "azdo-smoke-home-"));
  try {
    const env: Record<string, string | undefined> = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("KILO_AZDO_") || key === "AZDO_PAT" || key === "AZURE_DEVOPS_EXT_PAT") delete env[key];
    }
    env.HOME = home;
    env.USERPROFILE = home;
    const script = [
      `const mod = await import(${JSON.stringify(pathToFileURL(PLUGIN_PATH).href)});`,
      "const logs = [];",
      "const input = { client: { app: { log: (arg) => { logs.push(arg.body); } } } };",
      "const hooks = await mod.default.server(input, {});",
    "const logsAfterServer = logs.length;",
      "const cfg = { model: 'local' };",
      "await hooks.config(cfg);",
      "console.log(JSON.stringify({ cfg, logs, logsAfterServer }));",
    ].join("\n");
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { env, encoding: "utf8" });
    const result = JSON.parse(out) as { cfg: unknown; logs: Array<{ service: string; level: string; message: string }>; logsAfterServer: number };
    assert.equal(result.logsAfterServer, 0);
    assert.deepEqual(result.cfg, { model: "local" });
    assert.deepEqual(
      result.logs.map((l) => l.message),
      [
        "Remote config skipped: missing required settings: org, project, repo.",
        "Remote config unavailable (missing-settings) and no usable cache (cache-missing); continuing with local config only.",
      ],
    );
    assert.equal(existsSync(join(home, ".cache")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("no named export is a function and __internals has no server key", () => {
  for (const [name, value] of Object.entries(mod)) {
    if (name === "default") continue;
    assert.notEqual(typeof value, "function", `export ${name} must not be a function`);
  }
  assert.equal(typeof mod.__internals, "object");
  assert.equal("server" in mod.__internals, false);
  assert.equal(typeof (mod.__internals as { parseJsonc?: unknown }).parseJsonc, "function");
  assert.equal(typeof mod.__internals.resolvePlaceholders, "function");
  assert.equal(typeof mod.__internals.mergeConfig, "function");
  assert.equal(typeof mod.__internals.resolveSettings, "function");
  assert.equal(typeof mod.__internals.fetchRemoteConfig, "function");
  assert.equal(typeof mod.__internals.runConfigHook, "function");
  assert.deepEqual(Object.keys(mod.__internals), [
    "parseJsonc",
    "resolvePlaceholders",
    "mergeConfig",
    "resolveSettings",
    "fetchRemoteConfig",
    "runConfigHook",
  ]);
});

test("runtime named exports are exactly the documented set", () => {
  assert.deepEqual(Object.keys(mod).sort(), ["PLUGIN_ID", "SUPPORTED_KILO_RANGE", "__internals", "default"]);
});

test("SUPPORTED_KILO_RANGE is fixed", () => {
  assert.equal(mod.SUPPORTED_KILO_RANGE, ">=7.2.0 <8.0.0");
});
