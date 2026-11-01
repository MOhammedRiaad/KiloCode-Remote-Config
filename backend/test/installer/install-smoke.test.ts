import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  backendRoot,
  expectedItemsUrl,
  fakeNetworkUrl,
  readAzLog,
  readNetLog,
  requests,
  REQUIRED_ARGS,
  runInstall,
  snapshot,
  stubAz,
  withSandbox,
} from "./helpers.ts";
import type { FakeScenario, RunResult, Sandbox } from "./helpers.ts";

const KEY = "sk-bf-AbCdEf1234567890";
const PAT = "SENTINEL_PAT_VALUE_0013";
const BASIC_CRED = Buffer.from(`:${PAT}`, "utf8").toString("base64");
const AZ_TOKEN = "eyJ0eXAiOiJKV1Qi.SENTINEL_AZ_TOKEN_0013.sig";
const ERR_CANARY = "FETCH_THROW_CANARY_0013";
const BODY_CANARY = "HTTP_BODY_CANARY_0013";

const sharedConfig = readFileSync(join(backendRoot, "shared-config", "kilo.jsonc"), "utf8");
const helperPath = join(backendRoot, "installer", "install-helper.ts");
const MODELS_BODY = '{"object":"list","data":[]}';

const okScenario = (): FakeScenario => ({
  azdo: { status: 200, content: sharedConfig },
  bifrost: { status: 200, body: MODELS_BODY },
});

function assertLoaded(sb: Sandbox): void {
  const entries = readNetLog(sb);
  assert.ok(
    entries.some((e) => e.event === "loaded"),
    "expected fake-network preload loaded marker",
  );
}

function assertNoSecretsOrStack(r: RunResult): void {
  const combined = r.stdout + r.stderr;
  for (const secret of [
    KEY,
    "AbCdEf1234567890",
    PAT,
    BASIC_CRED,
    AZ_TOKEN,
    ERR_CANARY,
    BODY_CANARY,
    "bifrost.yourcompany.internal",
    "dev.azure.com",
  ]) {
    assert.equal(combined.includes(secret), false, `output leaked ${secret}`);
  }
  assert.doesNotMatch(combined, /\n\s+at /);
}

const HINT_SH =
  "Smoke test: a network check failed; connect to the corporate VPN or ask the platform team to add your public IP to the Azure firewall allow-list, then re-run install.sh.";

function assertProbeRequest(req: { url: string; method: string; headers: Record<string, string>; redirect: string }, url: string): void {
  assert.equal(req.url, url);
  assert.equal(req.method, "GET");
  assert.equal(req.redirect, "manual");
  assert.equal(req.headers["authorization"], undefined);
  assert.equal(req.headers["api-key"], undefined);
  assert.equal(req.headers["cookie"], undefined);
}

function seedPersonalConfig(sb: Sandbox, text: string): void {
  mkdirSync(sb.configDir, { recursive: true });
  writeFileSync(join(sb.configDir, "kilo.jsonc"), text);
}

test("AC-1 smoke test passes end-to-end with shipped shared config and Bifrost /v1/models", () => {
  withSandbox((sb) => {
    const r = runInstall(
      sb,
      [...REQUIRED_ARGS, "--path", "teams/core/kilo.jsonc", "--branch", "release/1"],
      { AZDO_PAT: PAT, KILO_BIFROST_KEY: KEY },
      { smoke: true, scenario: okScenario() },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\nsmoke network: pass\nsmoke azdo: pass\n/);
    assert.match(r.stdout, /\nsmoke bifrost: pass\nDone\.\n$/);
    assert.equal(r.stderr, "");
    assertLoaded(sb);

    const reqs = requests(sb);
    assert.equal(reqs.length, 4);
    assertProbeRequest(reqs[0]!, "https://dev.azure.com/");
    assertProbeRequest(reqs[2]!, "https://bifrost.yourcompany.internal/");

    const azdoReq = reqs[1]!;
    assert.equal(azdoReq.url, expectedItemsUrl("acme", "proj", "cfg", "/teams/core/kilo.jsonc", "release/1"));
    assert.equal(azdoReq.method, "GET");
    assert.equal(azdoReq.redirect, "manual");
    assert.equal(azdoReq.headers["authorization"], `Basic ${BASIC_CRED}`);

    const bifrostReq = reqs[3]!;
    assert.equal(bifrostReq.url, "https://bifrost.yourcompany.internal/v1/models");
    assert.equal(bifrostReq.method, "GET");
    assert.equal(bifrostReq.redirect, "manual");
    assert.equal(bifrostReq.headers["accept"], "application/json");
    assert.equal(bifrostReq.headers["authorization"], `Bearer ${KEY}`);
    assertNoSecretsOrStack(r);
  });
});

test("AC-2 Bifrost 401 and AzDO 404 exit 4, skip Bifrost on AzDO failure, and keep byte-identical installation", () => {
  const env = { AZDO_PAT: PAT, KILO_BIFROST_KEY: KEY };
  let expectedSnap: Record<string, string> = {};

  withSandbox((sbOk) => {
    const ok = runInstall(sbOk, REQUIRED_ARGS, env, { smoke: true, scenario: okScenario() });
    assert.equal(ok.status, 0, ok.stderr);
    expectedSnap = snapshot(sbOk.configDir);
  });

  withSandbox((sb401) => {
    const r = runInstall(sb401, REQUIRED_ARGS, env, {
      smoke: true,
      scenario: {
        azdo: { status: 200, content: sharedConfig },
        bifrost: { status: 401, body: `{"error":"${BODY_CANARY}"}` },
      },
    });
    assert.equal(r.status, 4);
    assert.match(r.stdout, /\nsmoke network: pass\nsmoke azdo: pass\nsmoke bifrost: fail 401\nDone\.\n$/);
    assert.match(r.stderr, /install\.sh: error: smoke test failed; the installation was kept\./);
    assertLoaded(sb401);
    assert.equal(requests(sb401).length, 4);
    assert.deepEqual(snapshot(sb401.configDir), expectedSnap);
    assertNoSecretsOrStack(r);
  });

  withSandbox((sb404) => {
    const r = runInstall(sb404, REQUIRED_ARGS, env, {
      smoke: true,
      scenario: {
        azdo: { status: 404, body: BODY_CANARY },
        bifrost: { status: 200, body: MODELS_BODY },
      },
    });
    assert.equal(r.status, 4);
    assert.match(
      r.stdout,
      /\nsmoke network: pass\nsmoke azdo: fail http-404\nsmoke bifrost: skipped azdo-failed\nDone\.\n$/,
    );
    assert.match(r.stderr, /install\.sh: error: smoke test failed; the installation was kept\./);
    assertLoaded(sb404);
    const reqs = requests(sb404);
    assert.equal(reqs.length, 2);
    assertProbeRequest(reqs[0]!, "https://dev.azure.com/");
    assert.ok(reqs[1]!.url.startsWith("https://dev.azure.com/acme/"));
    assert.deepEqual(snapshot(sb404.configDir), expectedSnap);
    assertNoSecretsOrStack(r);
  });
});

test("AC-3 timeouts and invalid/insecure shared configs exit 4 within bounded time without sending key to non-https", () => {
  const env = { AZDO_PAT: PAT, KILO_BIFROST_KEY: KEY, KILO_AZDO_TIMEOUT_MS: "300" };

  withSandbox((sb) => {
    const t0 = Date.now();
    const r = runInstall(sb, REQUIRED_ARGS, env, {
      smoke: true,
      scenario: { azdo: { mode: "hang" }, bifrost: { status: 200, body: MODELS_BODY } },
    });
    assert.equal(r.status, 4);
    assert.ok(Date.now() - t0 < 10_000);
    assert.equal(
      r.stdout.slice(r.stdout.indexOf("smoke network:")),
      `smoke network: fail azdo-timeout\nsmoke azdo: skipped network-blocked\nsmoke bifrost: skipped azdo-failed\n${HINT_SH}\nDone.\n`,
    );
    assertLoaded(sb);
    const reqs = requests(sb);
    assert.equal(reqs.length, 1);
    assertProbeRequest(reqs[0]!, "https://dev.azure.com/");
    assertNoSecretsOrStack(r);
  });

  withSandbox((sb) => {
    const r = runInstall(sb, REQUIRED_ARGS, env, {
      smoke: true,
      scenario: {
        azdoProbe: { status: 302 },
        azdo: { mode: "hang" },
        bifrost: { status: 200, body: MODELS_BODY },
      },
    });
    assert.equal(r.status, 4);
    assert.match(r.stdout, /\nsmoke network: pass\nsmoke azdo: fail timeout\nsmoke bifrost: skipped azdo-failed\nSmoke test: a network check failed; connect to the corporate VPN or ask the platform team to add your public IP to the Azure firewall allow-list, then re-run install\.sh\.\nDone\.\n$/);
    assertLoaded(sb);
    assert.equal(requests(sb).length, 2);
  });

  withSandbox((sb) => {
    const t0 = Date.now();
    const r = runInstall(sb, REQUIRED_ARGS, env, {
      smoke: true,
      scenario: { azdo: { status: 200, content: sharedConfig }, bifrost: { mode: "hang" } },
    });
    assert.equal(r.status, 4);
    assert.ok(Date.now() - t0 < 10_000);
    assert.match(
      r.stdout,
      /\nsmoke network: fail bifrost-timeout\nsmoke azdo: pass\nsmoke bifrost: skipped network-blocked\n/,
    );
    assertLoaded(sb);
    const reqs = requests(sb);
    assert.equal(reqs.length, 3);
    assertProbeRequest(reqs[2]!, "https://bifrost.yourcompany.internal/");
    assert.equal(JSON.stringify(reqs).includes(KEY), false);
    assertNoSecretsOrStack(r);
  });

  withSandbox((sb) => {
    const r = runInstall(sb, REQUIRED_ARGS, env, {
      smoke: true,
      scenario: {
        azdo: { status: 200, content: sharedConfig },
        bifrostProbe: { status: 404 },
        bifrost: { mode: "hang" },
      },
    });
    assert.equal(r.status, 4);
    assert.match(r.stdout, /\nsmoke network: pass\nsmoke azdo: pass\nsmoke bifrost: fail timeout\nSmoke test: a network check failed; connect to the corporate VPN or ask the platform team to add your public IP to the Azure firewall allow-list, then re-run install\.sh\.\nDone\.\n$/);
    assertLoaded(sb);
    assert.equal(requests(sb).length, 4);
  });

  const badSharedCases: Array<[string, RegExp]> = [
    ["{ invalid jsonc", /\nsmoke network: pass\nsmoke azdo: fail invalid-jsonc\nsmoke bifrost: skipped azdo-failed\n/],
    ["{}", /\nsmoke azdo: pass\nsmoke bifrost: fail no-base-url\n/],
    [
      '{"provider":{"bifrost":{"options":{"baseURL":"http://bifrost.yourcompany.internal/v1"}}}}',
      /\nsmoke azdo: pass\nsmoke bifrost: fail insecure-base-url\n/,
    ],
    [
      '{"provider":{"bifrost":{"options":{"baseURL":"not a valid url"}}}}',
      /\nsmoke azdo: pass\nsmoke bifrost: fail invalid-base-url\n/,
    ],
  ];

  for (const [content, pattern] of badSharedCases) {
    withSandbox((sb) => {
      const r = runInstall(sb, REQUIRED_ARGS, env, {
        smoke: true,
        scenario: { azdo: { status: 200, content }, bifrost: { status: 200, body: MODELS_BODY } },
      });
      assert.equal(r.status, 4);
      assert.match(r.stdout, pattern);
      assertLoaded(sb);
      const reqs = requests(sb);
      assert.equal(reqs.length, 2);
      assertProbeRequest(reqs[0]!, "https://dev.azure.com/");
      assert.ok(reqs[1]!.url.startsWith("https://dev.azure.com/acme/"));
    });
  }
});

test("AC-4 fresh install without key skips Bifrost with hint (exit 0); update without key uses stored key", () => {
  withSandbox((sb) => {
    const r = runInstall(sb, REQUIRED_ARGS, { AZDO_PAT: PAT }, { smoke: true, scenario: okScenario() });
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      r.stdout,
      /\nsmoke network: pass\nsmoke azdo: pass\nsmoke bifrost: skipped no-key\nSmoke test: set KILO_BIFROST_KEY and re-run install\.sh to check your Bifrost virtual key\.\nDone\.\n$/,
    );
    assertLoaded(sb);
    assert.equal(requests(sb).length, 2);
  });

  withSandbox((sb) => {
    seedPersonalConfig(
      sb,
      '{\n  "provider": { "bifrost": { "options": { "apiKey": "sk-bf-existing" } } }\n}\n',
    );
    const r = runInstall(sb, REQUIRED_ARGS, { AZDO_PAT: PAT }, { smoke: true, scenario: okScenario() });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\nsmoke network: pass\nsmoke azdo: pass\nsmoke bifrost: pass\nDone\.\n$/);
    assertLoaded(sb);
    const reqs = requests(sb);
    assert.equal(reqs.length, 4);
    assert.equal(reqs[3]!.headers["authorization"], "Bearer sk-bf-existing");
  });
});

test("AC-5 without PAT, stub az supplies Bearer token for AzDO while Bifrost receives only the virtual key", () => {
  withSandbox((sb) => {
    stubAz(sb, "ok", AZ_TOKEN);
    const r = runInstall(sb, REQUIRED_ARGS, { KILO_BIFROST_KEY: KEY }, { smoke: true, scenario: okScenario() });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\nsmoke network: pass\nsmoke azdo: pass\nsmoke bifrost: pass\nDone\.\n$/);
    assertLoaded(sb);

    const reqs = requests(sb);
    assert.equal(reqs.length, 4);
    assertProbeRequest(reqs[0]!, "https://dev.azure.com/");
    assertProbeRequest(reqs[2]!, "https://bifrost.yourcompany.internal/");
    assert.equal(reqs[1]!.headers["authorization"], `Bearer ${AZ_TOKEN}`);
    assert.equal(reqs[3]!.headers["authorization"], `Bearer ${KEY}`);
    assert.equal(JSON.stringify(reqs[3]!.headers).includes(AZ_TOKEN), false);
    assert.equal(JSON.stringify([reqs[0], reqs[2]]).includes(AZ_TOKEN), false);
    assertNoSecretsOrStack(r);
  });
});

test("AC-6 secrets, Basic credentials, body canaries and fetch error messages never appear in stdout/stderr", () => {
  const scenarios: Array<{ scenario: FakeScenario; useAz?: boolean }> = [
    { scenario: okScenario() },
    { scenario: okScenario(), useAz: true },
    {
      scenario: {
        azdo: { status: 200, content: sharedConfig },
        bifrost: { status: 401, body: `${BODY_CANARY} ${KEY}` },
      },
    },
    {
      scenario: {
        azdo: { status: 404, body: `${BODY_CANARY} ${PAT}` },
        bifrost: { status: 200, body: MODELS_BODY },
      },
    },
    {
      scenario: {
        azdo: { mode: "hang" },
        bifrost: { status: 200, body: MODELS_BODY },
      },
    },
    {
      scenario: {
        azdo: { mode: "throw", message: `${ERR_CANARY} ${PAT} ${BASIC_CRED}` },
        bifrost: { status: 200, body: MODELS_BODY },
      },
    },
    {
      scenario: {
        azdo: { status: 200, content: sharedConfig },
        bifrost: { mode: "throw", message: `${ERR_CANARY} ${KEY}` },
      },
    },
    {
      scenario: {
        azdo: { status: 200, content: sharedConfig },
        bifrost: { status: 200, body: `<html>${BODY_CANARY}</html>` },
      },
    },
    {
      scenario: {
        azdo: { status: 200, content: sharedConfig },
        bifrostProbe: { status: 403, body: `${BODY_CANARY}${KEY}` },
        bifrost: { status: 200, body: MODELS_BODY },
      },
    },
    {
      scenario: {
        azdo: { mode: "throw", message: `${ERR_CANARY} ${PAT} ${BASIC_CRED}` },
        bifrost: { status: 200, body: MODELS_BODY },
      },
    },
    {
      scenario: {
        azdoProbe: { status: 407, body: BODY_CANARY },
        azdo: { status: 200, content: sharedConfig },
        bifrost: { status: 200, body: MODELS_BODY },
      },
    },
  ];

  for (const item of scenarios) {
    withSandbox((sb) => {
      if (item.useAz) stubAz(sb, "ok", AZ_TOKEN);
      const env: Record<string, string> = {
        KILO_BIFROST_KEY: KEY,
        KILO_AZDO_TIMEOUT_MS: "150",
      };
      if (!item.useAz) env["AZDO_PAT"] = PAT;
      const r = runInstall(sb, REQUIRED_ARGS, env, { smoke: true, scenario: item.scenario });
      assertNoSecretsOrStack(r);
    });
  }
});

test("F-020 Bifrost behind the Azure IP firewall: key withheld, exit 4, installation kept (AC-2, AC-7)", () => {
  const env = { AZDO_PAT: PAT, KILO_BIFROST_KEY: KEY };
  let expectedSnap: Record<string, string> = {};
  withSandbox((sbOk) => {
    const ok = runInstall(sbOk, REQUIRED_ARGS, env, { smoke: true, scenario: okScenario() });
    assert.equal(ok.status, 0, ok.stderr);
    expectedSnap = snapshot(sbOk.configDir);
  });

  withSandbox((sb) => {
    const r = runInstall(sb, REQUIRED_ARGS, env, {
      smoke: true,
      scenario: {
        azdo: { status: 200, content: sharedConfig },
        bifrostProbe: { status: 403 },
        bifrost: { status: 200, body: MODELS_BODY },
      },
    });
    assert.equal(r.status, 4);
    assert.ok(
      r.stdout.endsWith(
        `smoke network: fail bifrost-blocked\nsmoke azdo: pass\nsmoke bifrost: skipped network-blocked\n${HINT_SH}\nDone.\n`,
      ),
      r.stdout,
    );
    assert.match(r.stderr, /install\.sh: error: smoke test failed; the installation was kept\./);
    assertLoaded(sb);
    const reqs = requests(sb);
    assert.equal(reqs.length, 3);
    assert.equal(
      reqs.some((req) => req.url.endsWith("/models")),
      false,
    );
    assert.equal(JSON.stringify(reqs).includes(KEY), false);
    assert.deepEqual(snapshot(sb.configDir), expectedSnap);
    assertNoSecretsOrStack(r);
  });
});

test("AC-7 --no-smoke skips HTTP requests, az token calls and smoke output; --no-smoke=x is a usage error", () => {
  withSandbox((sb) => {
    stubAz(sb, "ok", AZ_TOKEN);
    const r = runInstall(
      sb,
      [...REQUIRED_ARGS, "--no-smoke"],
      { KILO_BIFROST_KEY: KEY },
      { smoke: true, scenario: okScenario() },
    );
    assert.equal(r.status, 0, r.stderr);
    assertLoaded(sb);
    assert.deepEqual(requests(sb), []);
    const azLines = readAzLog(sb);
    assert.ok(azLines.some((line) => line.startsWith("account show")));
    assert.equal(
      azLines.some((line) => line.includes("get-access-token")),
      false,
    );
    assert.doesNotMatch(r.stdout, /^smoke /m);
    assert.doesNotMatch(r.stdout, /^smoke network/m);
    assert.doesNotMatch(r.stdout, /Smoke test:/);
  });

  withSandbox((sb) => {
    const r = runInstall(
      sb,
      [...REQUIRED_ARGS, "--no-smoke=SECRET_ARG_CANARY"],
      { AZDO_PAT: PAT },
      { smoke: true, scenario: okScenario() },
    );
    assert.equal(r.status, 2);
    assert.equal((r.stdout + r.stderr).includes("SECRET_ARG_CANARY"), false);
    assert.deepEqual(requests(sb), []);
  });
});

test("AC-7 pre-write failures (exit 1, 2, 3) never run the smoke test", () => {
  withSandbox((sb) => {
    const r1 = runInstall(sb, REQUIRED_ARGS, { KILO_BIFROST_KEY: KEY }, { smoke: true, scenario: okScenario() });
    assert.equal(r1.status, 1);
    assert.deepEqual(requests(sb), []);
    assert.doesNotMatch(r1.stdout + r1.stderr, /^smoke /m);
  });

  withSandbox((sb) => {
    const r2 = runInstall(
      sb,
      [...REQUIRED_ARGS, "--org", "bad/org"],
      { AZDO_PAT: PAT, KILO_BIFROST_KEY: KEY },
      { smoke: true, scenario: okScenario() },
    );
    assert.equal(r2.status, 2);
    assert.deepEqual(requests(sb), []);
    assert.doesNotMatch(r2.stdout + r2.stderr, /^smoke /m);
  });

  withSandbox((sb) => {
    seedPersonalConfig(sb, "{ malformed");
    const r3 = runInstall(
      sb,
      REQUIRED_ARGS,
      { AZDO_PAT: PAT, KILO_BIFROST_KEY: KEY },
      { smoke: true, scenario: okScenario() },
    );
    assert.equal(r3.status, 3);
    assert.deepEqual(requests(sb), []);
    assert.doesNotMatch(r3.stdout + r3.stderr, /^smoke /m);
  });
});

test("helper stdin protocol: omitted smoke record defaults to off; invalid or duplicate smoke exits 3", () => {
  const baseRecords = [
    "org=acme",
    "project=proj",
    "repo=cfg",
    "path=/kilo.jsonc",
    "branch=main",
    "mode=defaults",
    "apiKey=",
  ];

  withSandbox((sb) => {
    const netLogPath = join(sb.root, "direct-net.log");
    const netJsonPath = join(sb.root, "direct-net.json");
    writeFileSync(netJsonPath, JSON.stringify({ log: netLogPath, ...okScenario() }));
    const env: Record<string, string> = {
      HOME: sb.home,
      USERPROFILE: sb.home,
      XDG_CONFIG_HOME: sb.xdg,
      AZDO_PAT: PAT,
      NODE_OPTIONS: `--import=${fakeNetworkUrl}`,
      KILO_TEST_FAKE_NET: netJsonPath,
    };

    const rAbsent = spawnSync(process.execPath, [helperPath], {
      input: `${baseRecords.join("\0")}\0`,
      env,
      encoding: "utf8",
    });
    assert.equal(rAbsent.status, 0, rAbsent.stderr);
    assert.doesNotMatch(rAbsent.stdout, /^smoke /m);
    const entries = readFileSync(netLogPath, "utf8").trim().split("\n");
    assert.equal(entries.length, 1);

    for (const badTail of ["smoke=yes\0", "smoke=\0", "smoke=on\0smoke=off\0"]) {
      const rBad = spawnSync(process.execPath, [helperPath], {
        input: `${baseRecords.join("\0")}\0${badTail}`,
        env,
        encoding: "utf8",
      });
      assert.equal(rBad.status, 3);
      assert.match(rBad.stderr, /bad helper input/);
    }
  });
});

test("F-021 AC-7b: a plugin-side network failure after a reachable pre-flight exits 4 with exactly one network hint", () => {
  const env = { AZDO_PAT: PAT, KILO_BIFROST_KEY: KEY };
  withSandbox((sb) => {
    const r = runInstall(sb, REQUIRED_ARGS, env, {
      smoke: true,
      scenario: {
        azdoProbe: { status: 302 },
        azdo: { mode: "throw", message: ERR_CANARY },
        bifrost: { status: 200, body: MODELS_BODY },
      },
    });
    assert.equal(r.status, 4);
    assert.equal(
      r.stdout.slice(r.stdout.indexOf("smoke network:")),
      `smoke network: pass\nsmoke azdo: fail network-unreachable\nsmoke bifrost: skipped azdo-failed\n${HINT_SH}\nDone.\n`,
    );
    assertLoaded(sb);
    assert.equal(requests(sb).length, 2);
    assertNoSecretsOrStack(r);
  });
});

test("T-035 AC-4: an anonymous probe answered with HTTP 470 withholds the credential and exits 4", () => {
  const env = { AZDO_PAT: PAT, KILO_BIFROST_KEY: KEY };
  withSandbox((sb) => {
    const r = runInstall(sb, REQUIRED_ARGS, env, {
      smoke: true,
      scenario: {
        azdoProbe: { status: 470, body: "Action: Deny" },
        azdo: { status: 200, content: "{}" },
        bifrost: { status: 200, body: MODELS_BODY },
      },
    });
    assert.equal(r.status, 4);
    assert.equal(
      r.stdout.slice(r.stdout.indexOf("smoke network:")),
      `smoke network: fail azdo-blocked\nsmoke azdo: skipped network-blocked\nsmoke bifrost: skipped azdo-failed\n${HINT_SH}\nDone.\n`,
    );
    const reqs = requests(sb);
    assert.equal(reqs.length, 1);
    assertProbeRequest(reqs[0]!, "https://dev.azure.com/");
    assert.equal(JSON.stringify(reqs).includes(PAT), false);
    assertNoSecretsOrStack(r);
  });
});
