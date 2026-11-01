import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { __internals } from "../../plugin/azdo-remote-config.ts";
import {
  azLogExists,
  backendRoot,
  expectedItemsUrl,
  isWindows,
  REQUIRED_ARGS,
  runInstall,
  snapshot,
} from "../installer/helpers.ts";
import type { FakeAnswer, FakeScenario, RunInstallOptions, RunResult } from "../installer/helpers.ts";
import {
  assertNoLeaks,
  BASH_SKIP,
  DEFAULT_BINDING,
  expectedCache,
  parseShared,
  probeFetch,
  runStart,
  sharedConfigText,
  simulatorPath,
  withE2eSandbox,
} from "./helpers.ts";
import type { E2eSandbox, SimResult, StartRun } from "./helpers.ts";

const KEY = "sk-bf-AbCdEf1234567890";
const KEY_TAIL = "AbCdEf1234567890";
const OTHER_KEY = "sk-bf-OtherKey0987654321";
const PAT = "SENTINEL_PAT_VALUE_0016";
const BASIC = Buffer.from(`:${PAT}`, "utf8").toString("base64");
const THROW_CANARY = "FETCH_THROW_CANARY_0016";
const BODY_CANARY = "HTTP_BODY_CANARY_0016";
const SECRETS = [KEY, KEY_TAIL, OTHER_KEY, PAT, BASIC, THROW_CANARY, BODY_CANARY];
const ENV = { AZDO_PAT: PAT, KILO_BIFROST_KEY: KEY };
const SVC = "azdo-remote-config";
const OPTS = { skip: BASH_SKIP };

const azdoOk = (content: string): FakeAnswer => ({
  mode: "auth",
  authorization: "Basic " + BASIC,
  answer: { status: 200, content },
});
const bifrostAuth = (k: string): FakeAnswer => ({
  mode: "auth",
  authorization: "Bearer " + k,
  answer: { status: 200, body: '{"object":"list","data":[]}' },
});
const rec = (level: string, message: string) => ({ body: { service: SVC, level, message } });

// Parsed JSON is untyped by nature; the tests navigate it by path.
type Obj = Record<string, any>;
type Started = StartRun & { result: SimResult };

function checkOutput(label: string, r: { stdout: string; stderr: string }): void {
  assertNoLeaks(`${label} stdout`, r.stdout, SECRETS);
  assertNoLeaks(`${label} stderr`, r.stderr, SECRETS);
}

function install(
  sb: E2eSandbox,
  extra: string[] = [],
  env: Record<string, string> = ENV,
  opts: RunInstallOptions = {},
): RunResult {
  const r = runInstall(sb, [...REQUIRED_ARGS, ...extra], env, opts);
  checkOutput("installer", r);
  return r;
}

function start(sb: E2eSandbox, scenario: FakeScenario): Started {
  const run = runStart(sb, scenario, { AZDO_PAT: PAT });
  checkOutput("simulator", run);
  assert.doesNotMatch(run.stderr, /\n\s+at /);
  assert.equal(run.status, 0, "simulator exit status");
  assert.equal(run.stdout, "kilo-start-simulator: ok\n");
  assert.equal(run.loaded, true, "fake-network preload loaded");
  for (const q of run.requests) {
    assert.ok(
      q.url.startsWith("https://dev.azure.com/") || q.url.startsWith("https://bifrost.yourcompany.internal/"),
      "request to an unexpected host",
    );
  }
  assert.equal(azLogExists(sb), false, "az must never be invoked");
  assert.ok(run.result);
  assertNoLeaks("logs", JSON.stringify(run.result.logs), SECRETS);
  if (existsSync(sb.cacheFile)) assertNoLeaks("cache", readFileSync(sb.cacheFile, "utf8"), SECRETS);
  return { ...run, result: run.result };
}

const readJson = (path: string): Obj => JSON.parse(readFileSync(path, "utf8")) as Obj;
const modelKeys = (config: Obj): string[] => Object.keys(config["provider"].bifrost.models).sort();
const hex = (path: string): string => readFileSync(path).toString("hex");

test("T1 AC-1/AC-12: fresh install then first start applies shared config", OPTS, () => {
  withE2eSandbox((sb) => {
    assert.equal(install(sb).status, 0);
    const pluginPath = join(sb.configDir, "azdo", "azdo-remote-config.ts");
    assert.equal(hex(pluginPath), hex(join(backendRoot, "plugin", "azdo-remote-config.ts")));
    const shared = parseShared();
    const run = start(sb, { azdo: azdoOk(sharedConfigText()) });
    const { result } = run;
    const bifrost = (result.config["provider"] as Obj)["bifrost"];
    assert.equal(bifrost.options.baseURL, (shared["provider"] as Obj)["bifrost"].options.baseURL);
    assert.deepEqual(modelKeys(result.config), ["azure/gpt-5", "azure/gpt-5-mini"]);
    assert.equal(bifrost.options.apiKey, KEY);
    assert.equal(run.requests.length, 1);
    assert.equal(run.requests[0]?.url, expectedItemsUrl("acme", "proj", "cfg", "/kilo.jsonc", "main"));
    assert.equal(run.requests[0]?.headers["authorization"], "Basic " + BASIC);
    assert.deepEqual(result.logs, [
      rec("info", "Loaded shared config from Azure DevOps."),
      rec("info", "Applied shared config from remote in defaults mode."),
    ]);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]?.source, "config");
    assert.equal(result.entries[0]?.resolved, resolve(sb.configDir, "azdo", "azdo-remote-config.ts"));
    assert.equal(result.serverCalls, 1);
    assert.equal(result.hookCalls, 1);
    assert.equal(existsSync(join(sb.configDir, "plugin")), false);
    assert.equal(existsSync(join(sb.configDir, "plugins")), false);
    assert.ok(result.homedir.startsWith(sb.root), "homedir inside the sandbox");
    assert.ok(result.configDir.startsWith(sb.root), "configDir inside the sandbox");
    assert.deepEqual(readJson(sb.cacheFile), expectedCache(shared));
    if (!isWindows) assert.equal(statSync(sb.cacheFile).mode & 0o777, 0o600);
  });
});

test("T2 AC-2: changed shared file is picked up without re-running the installer", OPTS, () => {
  withE2eSandbox((sb) => {
    assert.equal(install(sb).status, 0);
    const snap0 = snapshot(sb.configDir);
    const v1 = parseShared();
    v1["small_model"] = "azure/gpt-5-mini";
    const v2 = structuredClone(v1);
    (v2["provider"] as Obj)["bifrost"].models["azure/gpt-5-nano"] = {};
    v2["small_model"] = "azure/gpt-5-nano";
    const r1 = start(sb, { azdo: azdoOk(JSON.stringify(v1)) });
    const r2 = start(sb, { azdo: azdoOk(JSON.stringify(v2)) });
    assert.ok(modelKeys(r2.result.config).includes("azure/gpt-5-nano"));
    assert.equal(r2.result.config["small_model"], "azure/gpt-5-nano");
    const back = structuredClone(r2.result.config) as Obj;
    delete back["provider"].bifrost.models["azure/gpt-5-nano"];
    back["small_model"] = "azure/gpt-5-mini";
    assert.deepEqual(back, r1.result.config);
    assert.deepEqual(snapshot(sb.configDir), snap0);
    assert.deepEqual(readJson(sb.cacheFile), expectedCache(v2));
    assert.equal(r1.requests.length, 1);
    assert.equal(r2.requests.length, 1);
  });
});

test("T3 AC-3: AzDO unreachable with a cache falls back to the cache", OPTS, () => {
  withE2eSandbox((sb) => {
    assert.equal(install(sb).status, 0);
    const first = start(sb, { azdo: azdoOk(sharedConfigText()) });
    const cacheBytes = hex(sb.cacheFile);
    const cases: [FakeAnswer, string][] = [
      [{ mode: "throw", message: THROW_CANARY }, "network"],
      [{ status: 500, body: BODY_CANARY }, "http-500"],
    ];
    for (const [azdo, reason] of cases) {
      const run = start(sb, { azdo });
      assert.deepEqual(run.result.config, first.result.config);
      assert.deepEqual(run.result.logs, [
        rec("warn", `Remote config unavailable (${reason}); using cached config.`),
        rec("info", "Applied shared config from cache in defaults mode."),
      ]);
      assert.equal(hex(sb.cacheFile), cacheBytes);
    }
  });
});

test("T4 AC-4/FR-10: AzDO unreachable without a cache keeps local config", OPTS, () => {
  withE2eSandbox((sb) => {
    assert.equal(install(sb).status, 0);
    const run = start(sb, { azdo: { mode: "throw", message: THROW_CANARY } });
    const local = __internals.parseJsonc(readFileSync(join(sb.configDir, "kilo.jsonc"), "utf8"));
    assert.deepEqual(run.result.config, run.result.initialConfig);
    assert.deepEqual(run.result.config, local);
    assert.deepEqual(run.result.logs, [
      rec(
        "error",
        "Remote config unavailable (network) and no usable cache (cache-missing); continuing with local config only.",
      ),
    ]);
    assert.equal(existsSync(sb.cacheFile), false);
  });
});

test("T3b T-013: a cache from another branch is not applied", OPTS, () => {
  withE2eSandbox((sb) => {
    assert.equal(install(sb).status, 0);
    const shared = parseShared();
    start(sb, { azdo: azdoOk(sharedConfigText()) });
    assert.deepEqual(readJson(sb.cacheFile), expectedCache(shared));
    const cacheBytes = hex(sb.cacheFile);
    assert.equal(install(sb, ["--branch", "release"]).status, 0);
    const offline = start(sb, { azdo: { mode: "throw", message: THROW_CANARY } });
    assert.deepEqual(offline.result.config, offline.result.initialConfig);
    assert.deepEqual(offline.result.logs, [
      rec(
        "error",
        "Remote config unavailable (network) and no usable cache (cache-mismatch); continuing with local config only.",
      ),
    ]);
    assert.equal(hex(sb.cacheFile), cacheBytes);
    const logsText = JSON.stringify(offline.result.logs);
    assert.ok(!logsText.includes("release") && !logsText.includes("acme"));
    const online = start(sb, { azdo: azdoOk(sharedConfigText()) });
    assert.equal(online.requests[0]?.url, expectedItemsUrl("acme", "proj", "cfg", "/kilo.jsonc", "release"));
    assert.deepEqual(readJson(sb.cacheFile), expectedCache(shared, { ...DEFAULT_BINDING, branch: "release" }));
  });
});

test("T5 AC-6/AC-7: defaults keep local values, enforce lets shared win, key is never replaced", OPTS, () => {
  withE2eSandbox((sb) => {
    assert.equal(install(sb).status, 0);
    const cfgPath = join(sb.configDir, "kilo.jsonc");
    const local = __internals.parseJsonc(readFileSync(cfgPath, "utf8")) as Obj;
    local["model"] = "local-model";
    writeFileSync(cfgPath, JSON.stringify(local, null, 2) + "\n");
    const shared = parseShared();
    shared["model"] = "azure/gpt-5";
    (shared["provider"] as Obj)["bifrost"].options.apiKey = "sk-bf-SharedDecoy00000000";
    const scenario = { azdo: azdoOk(JSON.stringify(shared)) };

    const d = start(sb, scenario);
    assert.equal(d.result.config["model"], "local-model");
    assert.equal((d.result.config["provider"] as Obj)["bifrost"].options.apiKey, KEY);
    assert.deepEqual(d.result.logs.at(-1), rec("info", "Applied shared config from remote in defaults mode."));

    assert.equal(install(sb, ["--mode", "enforce"]).status, 0);
    const installed = __internals.parseJsonc(readFileSync(cfgPath, "utf8")) as Obj;
    assert.equal(installed["plugin"][0][1].mode, "enforce");
    assert.equal(installed["model"], "local-model");
    assert.equal(installed["provider"].bifrost.options.apiKey, KEY);

    const e = start(sb, scenario);
    assert.equal(e.result.config["model"], "azure/gpt-5");
    assert.equal((e.result.config["provider"] as Obj)["bifrost"].options.apiKey, KEY);
    assert.deepEqual(e.result.logs.at(-1), rec("info", "Applied shared config from remote in enforce mode."));
    for (const run of [d, e]) assert.equal(JSON.stringify(run.result.config).includes("SharedDecoy"), false);
    assert.equal(readFileSync(sb.cacheFile, "utf8").includes("SharedDecoy"), false);
  });
});

test("T6 AC-10: the smoke test checks the key against fake Bifrost", OPTS, () => {
  const smokeOpts = (bifrost: FakeAnswer): RunInstallOptions => ({
    smoke: true,
    scenario: { azdo: azdoOk(sharedConfigText()), bifrost },
  });
  const wrongKeyEnv = { ...ENV, KILO_BIFROST_KEY: OTHER_KEY };
  let rejectedSnapshot: Record<string, string> = {};
  withE2eSandbox((sbA) => {
    const a = install(sbA, [], ENV, smokeOpts(bifrostAuth(KEY)));
    assert.equal(a.status, 0);
    assert.match(a.stdout, /\nsmoke azdo: pass\nsmoke bifrost: pass\nDone\.\n$/);

    const before = snapshot(sbA.configDir);
    const b = install(sbA, [], ENV, smokeOpts(bifrostAuth(OTHER_KEY)));
    assert.equal(b.status, 4);
    assert.match(b.stdout, /smoke bifrost: fail 401/);
    assert.ok(b.stderr.includes("install.sh: error: smoke test failed; the installation was kept."));
    assert.deepEqual(snapshot(sbA.configDir), before);

    const probe = probeFetch(sbA, { bifrost: bifrostAuth(KEY) }, "https://bifrost.yourcompany.internal/v1/models");
    checkOutput("probe", probe);
    assert.equal(probe.status, 0);
    assert.equal(probe.stdout, "401");
  });
  withE2eSandbox((sbB) => {
    const c = install(sbB, [], wrongKeyEnv, smokeOpts(bifrostAuth(KEY)));
    assert.equal(c.status, 4);
    assert.match(c.stdout, /smoke bifrost: fail 401/);
    rejectedSnapshot = snapshot(sbB.configDir);
  });
  withE2eSandbox((sbC) => {
    assert.equal(install(sbC, [], wrongKeyEnv).status, 0);
    assert.deepEqual(snapshot(sbC.configDir), rejectedSnapshot);
  });
});

test("T7 AC-9: no key, PAT or credential in any output, log or cache", OPTS, () => {
  const texts: string[] = [];
  const collect = (run: Started): void => {
    texts.push(run.stdout, run.stderr, JSON.stringify(run.result.logs));
    for (const log of run.result.logs) {
      const r = log as Obj;
      assert.deepEqual(Object.keys(r), ["body"]);
      assert.deepEqual(Object.keys(r["body"]), ["service", "level", "message"]);
      assert.equal(r["body"].service, SVC);
    }
  };
  withE2eSandbox((sb) => {
    const i = install(sb, [], ENV, smokeScenario());
    assert.equal(i.status, 0);
    texts.push(i.stdout, i.stderr);
    collect(start(sb, { azdo: azdoOk(sharedConfigText()) }));
    collect(start(sb, { azdo: { mode: "throw", message: THROW_CANARY } }));
    texts.push(readFileSync(sb.cacheFile, "utf8"));
  });
  withE2eSandbox((sb) => {
    const i = install(sb);
    texts.push(i.stdout, i.stderr);
    collect(start(sb, { azdo: { mode: "throw", message: THROW_CANARY } }));
  });
  assertNoLeaks("combined", texts.join("\n"), SECRETS);
});

function smokeScenario(): RunInstallOptions {
  return { smoke: true, scenario: { azdo: azdoOk(sharedConfigText()), bifrost: bifrostAuth(KEY) } };
}

test("harness: the simulator refuses to run without the fake-network preload", OPTS, () => {
  withE2eSandbox((sb) => {
    const r = spawnSync(process.execPath, [simulatorPath, "--out", join(sb.root, "none.json")], {
      cwd: sb.work,
      env: { HOME: sb.home, USERPROFILE: sb.home, PATH: sb.bin, KILO_TEST_FAKE_NET: join(sb.root, "none") },
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(r.status, 2);
    assert.equal(r.stderr.includes("kilo-start-simulator: error: fake network preload missing"), true);
    assert.equal(existsSync(join(sb.root, "none.json")), false);
  });
});
