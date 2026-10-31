import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backendRoot, expectedItemsUrl, readNetLog, requests, snapshot } from "./helpers.ts";
import type { FakeScenario } from "./helpers.ts";
import { helperPath, psTest, readLog, runInstallPs, stubAzPs, withPsSandbox } from "./ps-helpers.ts";
import type { PsRunResult, PsSandbox } from "./ps-helpers.ts";

const KEY = "sk-bf-AbCdEf1234567890";
const PAT = "SENTINEL_PAT_VALUE_0014";
const BASIC_CRED = Buffer.from(`:${PAT}`, "utf8").toString("base64");
const AZ_TOKEN = "eyJ0eXAiOiJKV1Qi.SENTINEL_AZ_TOKEN_0014.sig";
const BODY_CANARY = "HTTP_BODY_CANARY_0014";
const ARGS = ["-Org", "acme", "-Project", "proj", "-Repo", "cfg"];
const sharedConfig = readFileSync(join(backendRoot, "shared-config", "kilo.jsonc"), "utf8");

const okScenario = (): FakeScenario => ({
  azdo: { status: 200, content: sharedConfig },
  bifrost: { status: 200, body: '{"object":"list","data":[]}' },
});

const unauthorizedScenario = (): FakeScenario => ({
  azdo: { status: 200, content: sharedConfig },
  bifrost: { status: 401, body: `{"error":"${BODY_CANARY}"}` },
});

function assertClean(sb: PsSandbox, r: PsRunResult): void {
  const combined = r.stdout + r.stderr;
  for (const secret of [KEY, "AbCdEf1234567890", PAT, BASIC_CRED, AZ_TOKEN, BODY_CANARY]) {
    assert.equal(combined.includes(secret), false, `output leaked ${secret}`);
  }
  assert.doesNotMatch(combined, /\n\s+at /);
  for (const line of readLog(sb, "node-argv.log")) {
    assert.ok(line === "-p process.versions.node" || line.toLowerCase() === `"${helperPath}"`.toLowerCase(), line);
  }
}

psTest(
  "AC-6 smoke passes: one AzDO and one Bifrost request with the right credentials",
  (host) => {
    withPsSandbox((sb) => {
      const args = [...ARGS, "-Path", "teams/core/kilo.jsonc", "-Branch", "release/1"];
      const r = runInstallPs(sb, host, args, { AZDO_PAT: PAT, KILO_BIFROST_KEY: KEY }, { smoke: true, scenario: okScenario() });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /\nsmoke azdo: pass\nsmoke bifrost: pass\nDone\.\n$/);
      assert.equal(r.stderr, "");
      assert.ok(readNetLog(sb).some((e) => e.event === "loaded"));
      const reqs = requests(sb);
      assert.equal(reqs.length, 2);
      assert.equal(reqs[0]!.url, expectedItemsUrl("acme", "proj", "cfg", "/teams/core/kilo.jsonc", "release/1"));
      assert.equal(reqs[0]!.headers["authorization"], `Basic ${BASIC_CRED}`);
      assert.equal(reqs[1]!.url, "https://bifrost.yourcompany.internal/v1/models");
      assert.equal(reqs[1]!.headers["authorization"], `Bearer ${KEY}`);
      assertClean(sb, r);
    });
  },
  true,
);

psTest(
  "AC-6 Bifrost 401 exits 4, reports the failure and keeps the installation unchanged",
  (host) => {
    const env = { AZDO_PAT: PAT, KILO_BIFROST_KEY: KEY };
    let passing: Record<string, string> = {};
    withPsSandbox((sb) => {
      assert.equal(runInstallPs(sb, host, ARGS, env, { smoke: true, scenario: okScenario() }).status, 0);
      passing = snapshot(sb.configDir);
    });
    withPsSandbox((sb) => {
      const r = runInstallPs(sb, host, ARGS, env, { smoke: true, scenario: unauthorizedScenario() });
      assert.equal(r.status, 4);
      assert.match(r.stdout, /\nsmoke azdo: pass\nsmoke bifrost: fail 401\nDone\.\n$/);
      assert.equal(r.stderr, "install.ps1: error: smoke test failed; the installation was kept.\n");
      assert.deepEqual(snapshot(sb.configDir), passing);
      assertClean(sb, r);
    });
  },
  true,
);

psTest("AC-6 an AzDO failure skips Bifrost and exits 4", (host) => {
  withPsSandbox((sb) => {
    const scenario: FakeScenario = { azdo: { status: 404, body: BODY_CANARY } };
    const r = runInstallPs(sb, host, ARGS, { AZDO_PAT: PAT, KILO_BIFROST_KEY: KEY }, { smoke: true, scenario });
    assert.equal(r.status, 4);
    assert.match(r.stdout, /\nsmoke azdo: fail http-404\nsmoke bifrost: skipped azdo-failed\nDone\.\n$/);
    assert.equal(requests(sb).length, 1);
    assertClean(sb, r);
  });
});

psTest("AC-6 the default harness run (-NoSmoke) sends no request and prints no smoke line", (host) => {
  withPsSandbox((sb) => {
    const r = runInstallPs(sb, host, ARGS, { AZDO_PAT: PAT, KILO_BIFROST_KEY: KEY }, { scenario: okScenario() });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(readNetLog(sb).some((e) => e.event === "loaded"));
    assert.deepEqual(requests(sb), []);
    assert.doesNotMatch(r.stdout, /smoke/);
    assert.match(r.stdout, /Done\.\n$/);
  });
});

psTest("AC-6 an explicit -nosmoke (any case) skips the smoke test", (host) => {
  withPsSandbox((sb) => {
    const r = runInstallPs(sb, host, [...ARGS, "-nosmoke"], { AZDO_PAT: PAT }, { smoke: true, scenario: okScenario() });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(requests(sb), []);
    assert.doesNotMatch(r.stdout, /smoke/);
  });
});

psTest("AC-6 without a key Bifrost is skipped and the hint names install.ps1", (host) => {
  withPsSandbox((sb) => {
    const r = runInstallPs(sb, host, ARGS, { AZDO_PAT: PAT }, { smoke: true, scenario: okScenario() });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\nsmoke azdo: pass\nsmoke bifrost: skipped no-key\n/);
    assert.match(r.stdout, /\nSmoke test: set KILO_BIFROST_KEY and re-run install\.ps1 to check your Bifrost virtual key\.\nDone\.\n$/);
    assert.equal(requests(sb).length, 1);
    assertClean(sb, r);
  });
});

psTest("AC-7 the az token path never leaks the token", (host) => {
  withPsSandbox((sb) => {
    stubAzPs(sb, "ok", AZ_TOKEN);
    const r = runInstallPs(sb, host, ARGS, { KILO_BIFROST_KEY: KEY }, { smoke: true, scenario: okScenario() });
    assert.equal(r.status, 0, r.stderr);
    const reqs = requests(sb);
    assert.equal(reqs[0]!.headers["authorization"], `Bearer ${AZ_TOKEN}`);
    assert.equal(JSON.stringify(reqs[1]!.headers).includes(AZ_TOKEN), false);
    assertClean(sb, r);
  });
});
