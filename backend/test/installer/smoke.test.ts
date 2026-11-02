import assert from "node:assert/strict";
import { test } from "node:test";
import { PLACEHOLDER_KEY, storedApiKey } from "../../installer/personal-config-edit.ts";
import type { Values } from "../../installer/personal-config-edit.ts";
import {
  classifyKey,
  classifyProbeStatus,
  formatSmoke,
  modelsUrl,
  pickSmokeEnv,
  probeOrigin,
  runSmoke,
  SMOKE_ENV_NAMES,
  smokeFailed,
} from "../../installer/smoke.ts";
import type { SmokeDeps, SmokeReport } from "../../installer/smoke.ts";

// Pure unit tests: injected fake fetch / runAz / env only; no network, no az, no child process.

const VALUES: Values = {
  org: "acme",
  project: "platform",
  repo: "kilo-config",
  path: "/kilo.jsonc",
  branch: "main",
  mode: "defaults",
};

const KEY = "sk-bf-AbCdEf1234567890";
const PAT = "PAT_SENTINEL_9911";
const BASIC_CRED = Buffer.from(`:${PAT}`, "utf8").toString("base64");
const TOKEN = "tok.AZ_SENTINEL_2233";
const ERR_CANARY = "UNDERLYING_FETCH_ERROR_CANARY";
const BODY_CANARY = "RESPONSE_BODY_SECRET_CANARY";
const MIB = 1048576;

const SHARED_OK = `// comment\n{\n  "provider": {\n    "bifrost": {\n      "options": {\n        "baseURL": "https://bifrost.yourcompany.internal/v1",\n      },\n    },\n  },\n}\n`;
const MODELS_OK = '{"object":"list","data":[]}';

interface RecordedCall {
  url: string;
  init: { method: "GET"; headers: Record<string, string>; redirect: "manual"; signal: AbortSignal };
}

type FetchFn = NonNullable<SmokeDeps["fetch"]>;

function makeFetch(handler: (call: RecordedCall) => unknown | Promise<unknown>): {
  calls: RecordedCall[];
  fn: FetchFn;
} {
  const calls: RecordedCall[] = [];
  const fn: FetchFn = async (url, init) => {
    const call: RecordedCall = { url, init };
    calls.push(call);
    return handler(call);
  };
  return { calls, fn };
}

function azdoJson(content: string, status = 200): Response {
  return new Response(JSON.stringify({ content }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function assertNoLeak(report: SmokeReport): void {
  const lines = formatSmoke(report).join("\n");
  const dump = `${JSON.stringify(report)}\n${lines}`;
  for (const secret of [KEY, "AbCdEf1234567890", PAT, BASIC_CRED, TOKEN, ERR_CANARY, BODY_CANARY]) {
    assert.equal(dump.includes(secret), false, `leaked ${secret}`);
  }
  for (const text of ["bifrost.yourcompany.internal", "dev.azure.com", "https://"]) {
    assert.equal(lines.includes(text), false, `printed ${text}`);
  }
}

const HINT_SH =
  "Smoke test: a network check failed; connect to the corporate VPN or ask the platform team to add your public IP to the Azure firewall allow-list, then re-run install.sh.";

function isProbeUrl(url: string): boolean {
  const parsed = new URL(url);
  return parsed.pathname === "/" && parsed.search === "" && parsed.hash === "";
}

function assertProbeCall(call: RecordedCall, expectedUrl: string): void {
  assert.equal(call.url, expectedUrl);
  const parsed = new URL(call.url);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.pathname, "/");
  assert.equal(parsed.search, "");
  assert.equal(parsed.hash, "");
  assert.equal(call.init.method, "GET");
  assert.equal(call.init.redirect, "manual");
  assert.equal(call.init.signal instanceof AbortSignal, true);
  assert.equal(Object.hasOwn(call.init, "body"), false);
  assert.deepEqual(call.init.headers, {});
}

function assertAllProbes(calls: RecordedCall[]): void {
  for (const call of calls.filter((c) => isProbeUrl(c.url))) assertProbeCall(call, call.url);
}

test("SMOKE_ENV_NAMES and pickSmokeEnv copy only allow-listed own string variables", () => {
  assert.deepEqual(SMOKE_ENV_NAMES, ["AZDO_PAT", "AZURE_DEVOPS_EXT_PAT", "KILO_AZDO_PAT", "KILO_AZDO_TIMEOUT_MS"]);
  const proto = { AZDO_PAT: "inherited" };
  const source = Object.assign(Object.create(proto) as Record<string, string | undefined>, {
    KILO_AZDO_PAT: "own-pat",
    KILO_AZDO_TIMEOUT_MS: "1200",
    AZURE_DEVOPS_EXT_PAT: undefined,
    KILO_AZDO_ORG: "other-org",
    KILO_AZDO_PATH: "C:/Program Files/Git/kilo.jsonc",
    KILO_BIFROST_KEY: KEY,
    PATH: "/usr/bin",
  });
  assert.deepEqual(pickSmokeEnv(source), {
    KILO_AZDO_PAT: "own-pat",
    KILO_AZDO_TIMEOUT_MS: "1200",
  });
});

test("modelsUrl normalises valid https baseURLs and appends /models", () => {
  for (const input of [
    "https://bifrost.yourcompany.internal/v1",
    "https://bifrost.yourcompany.internal/v1/",
    "https://bifrost.yourcompany.internal/v1//",
    "  https://bifrost.yourcompany.internal/v1/  ",
  ]) {
    assert.deepEqual(modelsUrl(input), {
      ok: true,
      url: "https://bifrost.yourcompany.internal/v1/models",
    });
  }
  assert.deepEqual(modelsUrl("https://h"), { ok: true, url: "https://h/models" });
  assert.deepEqual(modelsUrl("https://h/"), { ok: true, url: "https://h/models" });
});

test("modelsUrl rejects missing, non-https and invalid baseURLs with fixed codes", () => {
  for (const missing of [undefined, null, 42, {}, []]) {
    assert.deepEqual(modelsUrl(missing), { ok: false, code: "no-base-url" });
  }
  for (const insecure of ["http://bifrost.yourcompany.internal/v1", "ftp://bifrost.yourcompany.internal/v1", "custom:endpoint"]) {
    assert.deepEqual(modelsUrl(insecure), { ok: false, code: "insecure-base-url" });
  }
  for (const invalid of [
    "",
    "not a url",
    "{env:BIFROST_URL}",
    "https://u:p@h/v1",
    "https://u@h/v1",
    "https://@h/v1",
    "https://h/v1?x=1",
    "https://h/v1?",
    "https://h/v1#f",
    "https://h/v1#",
  ]) {
    assert.deepEqual(modelsUrl(invalid), { ok: false, code: "invalid-base-url" }, invalid);
  }
});

test("classifyKey distinguishes missing/placeholder, placeholder references, invalid and valid keys", () => {
  for (const noKey of [PLACEHOLDER_KEY, "", undefined, null, 42]) {
    assert.deepEqual(classifyKey(noKey), {
      ok: false,
      outcome: { status: "skipped", code: "no-key" },
    });
  }
  for (const ref of ["{env:K}", "{file:~/secret}", "prefix-{env:K}"]) {
    assert.deepEqual(classifyKey(ref), {
      ok: false,
      outcome: { status: "skipped", code: "key-reference" },
    });
  }
  for (const bad of ["a b", "\u00e9", "a\nb", "x".repeat(4097)]) {
    assert.deepEqual(classifyKey(bad), {
      ok: false,
      outcome: { status: "fail", code: "invalid-key" },
    });
  }
  assert.deepEqual(classifyKey("sk-bf-x"), { ok: true, key: "sk-bf-x" });
  const maxKey = "k".repeat(4096);
  assert.deepEqual(classifyKey(maxKey), { ok: true, key: maxKey });
});

const PASS_NET = { status: "pass" } as const;

test("formatSmoke and smokeFailed follow contract section 7 and 9", () => {
  const passReport: SmokeReport = { network: PASS_NET, azdo: { status: "pass" }, bifrost: { status: "pass" } };
  assert.deepEqual(formatSmoke(passReport), ["smoke network: pass", "smoke azdo: pass", "smoke bifrost: pass"]);
  assert.equal(smokeFailed(passReport), false);

  const noKeyReport: SmokeReport = {
    network: PASS_NET,
    azdo: { status: "pass" },
    bifrost: { status: "skipped", code: "no-key" },
  };
  assert.deepEqual(formatSmoke(noKeyReport), [
    "smoke network: pass",
    "smoke azdo: pass",
    "smoke bifrost: skipped no-key",
    "Smoke test: set KILO_BIFROST_KEY and re-run install.sh to check your Bifrost virtual key.",
  ]);
  assert.equal(smokeFailed(noKeyReport), false);

  const refReport: SmokeReport = {
    network: PASS_NET,
    azdo: { status: "pass" },
    bifrost: { status: "skipped", code: "key-reference" },
  };
  assert.deepEqual(formatSmoke(refReport), [
    "smoke network: pass",
    "smoke azdo: pass",
    "smoke bifrost: skipped key-reference",
  ]);
  assert.equal(smokeFailed(refReport), false);

  const failReport: SmokeReport = {
    network: PASS_NET,
    azdo: { status: "fail", code: "http-404" },
    bifrost: { status: "skipped", code: "azdo-failed" },
  };
  assert.deepEqual(formatSmoke(failReport), [
    "smoke network: pass",
    "smoke azdo: fail http-404",
    "smoke bifrost: skipped azdo-failed",
  ]);
  assert.equal(smokeFailed(failReport), true);
});

test("classifyProbeStatus: 403, 407 and 470 are blocked, undefined is unreachable, everything else is reachable", () => {
  const table: Array<[number | undefined, string]> = [
    [100, "reachable"],
    [199, "reachable"],
    [200, "reachable"],
    [302, "reachable"],
    [401, "reachable"],
    [403, "blocked"],
    [404, "reachable"],
    [407, "blocked"],
    [469, "reachable"],
    [470, "blocked"],
    [471, "reachable"],
    [599, "reachable"],
    [undefined, "unreachable"],
  ];
  for (const [status, verdict] of table) assert.equal(classifyProbeStatus(status), verdict, String(status));
});

test("probeOrigin returns the https origin with a single trailing slash", () => {
  assert.equal(probeOrigin("https://bifrost.yourcompany.internal/v1/models"), "https://bifrost.yourcompany.internal/");
  assert.equal(probeOrigin("https://h:8443/a/b/models"), "https://h:8443/");
});

test("runSmoke happy path: probe, items call, probe, models call in order with exact URL, headers and redirect manual", async () => {
  let azCalled = false;
  const fake = makeFetch(({ url }) => {
    if (isProbeUrl(url)) return new Response("", { status: 200 });
    if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
    return new Response(MODELS_OK, { status: 200 });
  });
  const report = await runSmoke(VALUES, KEY, {
    env: {
      AZDO_PAT: PAT,
      KILO_AZDO_ORG: "must-be-ignored",
      KILO_AZDO_PATH: "C:/must-be-ignored",
    },
    fetch: fake.fn,
    runAz: () => {
      azCalled = true;
      return Promise.resolve({ exitCode: 0, stdout: TOKEN });
    },
  });
  assert.deepEqual(report, { network: PASS_NET, azdo: { status: "pass" }, bifrost: { status: "pass" } });
  assert.equal(formatSmoke(report)[0], "smoke network: pass");
  assert.equal(azCalled, false);
  assert.equal(fake.calls.length, 4);
  assertProbeCall(fake.calls[0]!, "https://dev.azure.com/");
  assertProbeCall(fake.calls[2]!, "https://bifrost.yourcompany.internal/");

  const azdoCall = fake.calls[1]!;
  assert.equal(
    azdoCall.url,
    "https://dev.azure.com/acme/platform/_apis/git/repositories/kilo-config/items?path=%2Fkilo.jsonc&versionDescriptor.version=main&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1",
  );
  assert.equal(azdoCall.init.redirect, "manual");
  assert.equal(azdoCall.init.headers["Authorization"], `Basic ${BASIC_CRED}`);
  assert.equal(JSON.stringify(azdoCall.init.headers).includes(KEY), false);

  const bifrostCall = fake.calls[3]!;
  assert.equal(bifrostCall.url, "https://bifrost.yourcompany.internal/v1/models");
  assert.equal(bifrostCall.init.method, "GET");
  assert.equal(bifrostCall.init.redirect, "manual");
  assert.deepEqual(bifrostCall.init.headers, {
    Accept: "application/json",
    "x-bf-vk": KEY,
  });
  assertNoLeak(report);
});

test("runSmoke uses az token for AzDO when no PAT is set and never sends token to Bifrost (AC-5)", async () => {
  let azCalls = 0;
  const fake = makeFetch(({ url }) => {
    if (isProbeUrl(url)) return new Response("", { status: 200 });
    if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
    return new Response(MODELS_OK, { status: 200 });
  });
  const report = await runSmoke(VALUES, KEY, {
    env: {},
    fetch: fake.fn,
    runAz: () => {
      azCalls++;
      return Promise.resolve({ exitCode: 0, stdout: `${TOKEN}\n` });
    },
  });
  assert.deepEqual(report, { network: PASS_NET, azdo: { status: "pass" }, bifrost: { status: "pass" } });
  assert.equal(azCalls, 1);
  assert.equal(fake.calls.length, 4);
  assertAllProbes(fake.calls);
  assert.equal(fake.calls[1]!.init.headers["Authorization"], `Bearer ${TOKEN}`);
  assert.deepEqual(fake.calls[3]!.init.headers, {
    Accept: "application/json",
    "x-bf-vk": KEY,
  });
  assert.equal(JSON.stringify(fake.calls[3]!.init.headers).includes(TOKEN), false);
  assertNoLeak(report);
});

test("runSmoke reports bare HTTP status on Bifrost non-2xx (401, 302) without following redirects", async () => {
  for (const status of [401, 302]) {
    const fake = makeFetch(({ url }) => {
      if (isProbeUrl(url)) return new Response("", { status: 200 });
      if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
      return new Response(BODY_CANARY, { status, headers: { location: "http://evil.example/models" } });
    });
    const report = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(report, {
      network: PASS_NET,
      azdo: { status: "pass" },
      bifrost: { status: "fail", code: String(status) },
    });
    assert.equal(fake.calls.length, 4);
    assertAllProbes(fake.calls);
    assertNoLeak(report);
  }
});

test("runSmoke skips Bifrost when AzDO fails (http-404, invalid-jsonc, invalid-shape)", async () => {
  const cases: Array<[() => Response, string]> = [
    [() => new Response(BODY_CANARY, { status: 404 }), "http-404"],
    [() => azdoJson(`{ "broken": "${BODY_CANARY}`), "invalid-jsonc"],
    [() => azdoJson(`["${BODY_CANARY}"]`), "invalid-shape"],
  ];
  for (const [azdoResponse, expectedCode] of cases) {
    const fake = makeFetch(({ url }) => (isProbeUrl(url) ? new Response("", { status: 404 }) : azdoResponse()));
    const report = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(report, {
      network: PASS_NET,
      azdo: { status: "fail", code: expectedCode },
      bifrost: { status: "skipped", code: "azdo-failed" },
    });
    assert.equal(fake.calls.length, 2);
    assertAllProbes(fake.calls);
    assertNoLeak(report);
  }
});

test("runSmoke never calls Bifrost when baseURL is missing, insecure or invalid, or key is skipped/invalid (AC-5)", async () => {
  const badConfigs: Array<[string, string]> = [
    ["{}", "no-base-url"],
    ['{"provider":[]}', "no-base-url"],
    ['{"provider":{"bifrost":{"options":{"baseURL":123}}}}', "no-base-url"],
    ['{"provider":{"bifrost":{"options":{"baseURL":"http://bifrost.internal/v1"}}}}', "insecure-base-url"],
    ['{"provider":{"bifrost":{"options":{"baseURL":"https://h/v1?x=1"}}}}', "invalid-base-url"],
  ];
  for (const [content, code] of badConfigs) {
    const fake = makeFetch(({ url }) => (isProbeUrl(url) ? new Response("", { status: 200 }) : azdoJson(content)));
    const report = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(report, {
      network: PASS_NET,
      azdo: { status: "pass" },
      bifrost: { status: "fail", code },
    });
    assert.equal(fake.calls.length, 2);
    assert.equal(
      fake.calls.every((call) => call.url.startsWith("https://dev.azure.com/")),
      true,
    );
  }

  for (const [keyInput, expected] of [
    [PLACEHOLDER_KEY, { status: "skipped", code: "no-key" }],
    ["{env:MY_KEY}", { status: "skipped", code: "key-reference" }],
    ["bad key", { status: "fail", code: "invalid-key" }],
  ] as const) {
    const fake = makeFetch(({ url }) => (isProbeUrl(url) ? new Response("", { status: 200 }) : azdoJson(SHARED_OK)));
    const report = await runSmoke(VALUES, keyInput, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(report, { network: PASS_NET, azdo: { status: "pass" }, bifrost: expected });
    assert.equal(fake.calls.length, 2);
    assert.equal(
      fake.calls.every((call) => call.url.startsWith("https://dev.azure.com/")),
      true,
    );
  }
});

test("runSmoke network probe passes for 200, 204, 302, 401, 404, 405, 500 and 503 (AC-1)", async () => {
  for (const status of [200, 204, 302, 401, 404, 405, 500, 503]) {
    const fake = makeFetch(({ url }) => {
      if (isProbeUrl(url)) return new Response(status === 204 ? null : "x", { status });
      if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
      return new Response(MODELS_OK, { status: 200 });
    });
    const report = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(report, { network: PASS_NET, azdo: { status: "pass" }, bifrost: { status: "pass" } }, String(status));
    assert.equal(fake.calls.length, 4);
    assertProbeCall(fake.calls[0]!, "https://dev.azure.com/");
    assertProbeCall(fake.calls[2]!, "https://bifrost.yourcompany.internal/");
  }
});

test("runSmoke withholds the virtual key when the Bifrost origin answers 403, 407 or 470 (AC-2, T-035 AC-4)", async () => {
  for (const status of [403, 407, 470]) {
    const fake = makeFetch(({ url }) => {
      if (url === "https://bifrost.yourcompany.internal/") {
        return new Response(`<html>${BODY_CANARY}${KEY}</html>`, { status });
      }
      if (url.startsWith("https://dev.azure.com/") && isProbeUrl(url)) return new Response("", { status: 200 });
      if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
      return new Response(MODELS_OK, { status: 200 });
    });
    const report = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(report, {
      network: { status: "fail", codes: ["bifrost-blocked"] },
      azdo: { status: "pass" },
      bifrost: { status: "skipped", code: "network-blocked" },
    });
    assert.equal(fake.calls.length, 3);
    assert.equal(
      fake.calls.some((call) => call.url.endsWith("/models")),
      false,
    );
    assert.equal(
      fake.calls.some((call) => JSON.stringify(call.init.headers).includes(KEY)),
      false,
    );
    assert.equal(smokeFailed(report), true);
    const lines = formatSmoke(report);
    assert.equal(lines[0], "smoke network: fail bifrost-blocked");
    assert.equal(lines[1], "smoke azdo: pass");
    assert.equal(lines[2], "smoke bifrost: skipped network-blocked");
    assert.equal(lines.length, 4);
    assert.equal(lines[3], HINT_SH);
    assertNoLeak(report);
  }
});

test("runSmoke AzDO probe reject or hang yields azdo-unreachable / azdo-timeout and sends no credential (AC-3)", async () => {
  let azCalls = 0;
  const runAz = () => {
    azCalls++;
    return Promise.resolve({ exitCode: 0, stdout: TOKEN });
  };
  const rejecting = makeFetch(() => Promise.reject(new Error(`${ERR_CANARY} ${PAT}`)));
  const r1 = await runSmoke(VALUES, KEY, { env: {}, fetch: rejecting.fn, runAz });
  assert.deepEqual(r1, {
    network: { status: "fail", codes: ["azdo-unreachable"] },
    azdo: { status: "skipped", code: "network-blocked" },
    bifrost: { status: "skipped", code: "azdo-failed" },
  });
  assert.equal(rejecting.calls.length, 1);
  assertProbeCall(rejecting.calls[0]!, "https://dev.azure.com/");
  assertNoLeak(r1);

  const t0 = Date.now();
  const hanging = makeFetch(({ init }) => new Promise<Response>(() => void init));
  const r2 = await runSmoke(VALUES, KEY, { env: { KILO_AZDO_TIMEOUT_MS: "50" }, fetch: hanging.fn, runAz });
  assert.deepEqual(r2, {
    network: { status: "fail", codes: ["azdo-timeout"] },
    azdo: { status: "skipped", code: "network-blocked" },
    bifrost: { status: "skipped", code: "azdo-failed" },
  });
  assert.equal(hanging.calls.length, 1);
  assert.equal(hanging.calls[0]!.init.signal.aborted, true);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(azCalls, 0);
  assert.equal(formatSmoke(r2).length, 4);
  assertNoLeak(r2);
});

test("runSmoke Bifrost probe reject or hang yields bifrost-unreachable / bifrost-timeout and never sends the key (AC-3)", async () => {
  const rejecting = makeFetch(({ url }) => {
    if (url === "https://bifrost.yourcompany.internal/") return Promise.reject(new Error(`${ERR_CANARY} ${KEY}`));
    if (isProbeUrl(url)) return new Response("", { status: 200 });
    return azdoJson(SHARED_OK);
  });
  const r1 = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: rejecting.fn });
  assert.deepEqual(r1, {
    network: { status: "fail", codes: ["bifrost-unreachable"] },
    azdo: { status: "pass" },
    bifrost: { status: "skipped", code: "network-blocked" },
  });
  assert.equal(rejecting.calls.length, 3);
  assert.equal(
    rejecting.calls.some((call) => JSON.stringify(call.init.headers).includes(KEY)),
    false,
  );
  assertNoLeak(r1);

  const t0 = Date.now();
  const hanging = makeFetch(({ url }) => {
    if (url === "https://bifrost.yourcompany.internal/") return new Promise<Response>(() => undefined);
    if (isProbeUrl(url)) return new Response("", { status: 200 });
    return azdoJson(SHARED_OK);
  });
  const r2 = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT, KILO_AZDO_TIMEOUT_MS: "50" }, fetch: hanging.fn });
  assert.deepEqual(r2, {
    network: { status: "fail", codes: ["bifrost-timeout"] },
    azdo: { status: "pass" },
    bifrost: { status: "skipped", code: "network-blocked" },
  });
  assert.equal(hanging.calls.length, 3);
  assert.equal(hanging.calls[2]!.init.signal.aborted, true);
  assert.ok(Date.now() - t0 < 2000);
  assertNoLeak(r2);
});

test("runSmoke probe timeout also works with an injected fake clock (AC-3)", async () => {
  const fired: Array<() => void> = [];
  const cleared: unknown[] = [];
  const hanging = makeFetch(() => new Promise<Response>(() => undefined));
  const pending = runSmoke(VALUES, KEY, {
    env: {},
    fetch: hanging.fn,
    setTimeout: (callback: () => void) => {
      fired.push(callback);
      return fired.length;
    },
    clearTimeout: (handle: unknown) => {
      cleared.push(handle);
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fired.length, 1);
  fired[0]!();
  const report = await pending;
  assert.deepEqual(report.network, { status: "fail", codes: ["azdo-timeout"] });
  assert.equal(hanging.calls[0]!.init.signal.aborted, true);
  assert.deepEqual(cleared, [1]);
});

test("every probe call is an anonymous manual-redirect GET to an https origin (AC-4)", async () => {
  const fake = makeFetch(({ url }) => {
    if (isProbeUrl(url)) return new Response(null, { status: 204 });
    if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
    return new Response(MODELS_OK, { status: 200 });
  });
  await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
  const probes = fake.calls.filter((call) => isProbeUrl(call.url));
  assert.equal(probes.length, 2);
  assertAllProbes(fake.calls);
  for (const call of fake.calls.filter((c) => !isProbeUrl(c.url))) {
    assert.notDeepEqual(call.init.headers, {});
  }
});

test("a probe value without a valid status is unreachable; a non-function fetch is internal and no VPN hint (AC-6)", async () => {
  for (const bad of [{}, { status: 0 }, { status: "200" }, null, { status: 99 }, { status: 600 }, { status: 200.5 }]) {
    const fake = makeFetch(() => bad);
    const report = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(report.network, { status: "fail", codes: ["azdo-unreachable"] }, JSON.stringify(bad));
    assert.equal(fake.calls.length, 1);
  }

  const originalFetch = globalThis.fetch;
  const guardCalls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    guardCalls.push(String(input));
    throw new Error("real fetch must not be used");
  }) as typeof globalThis.fetch;
  try {
    const report = await runSmoke(VALUES, KEY, { env: {}, fetch: 42 } as unknown as SmokeDeps);
    assert.deepEqual(report, {
      network: { status: "fail", codes: ["internal"] },
      azdo: { status: "skipped", code: "network-blocked" },
      bifrost: { status: "skipped", code: "azdo-failed" },
    });
    assert.equal(guardCalls.length, 0);
    assert.equal(smokeFailed(report), true);
    assert.deepEqual(formatSmoke(report), [
      "smoke network: fail internal",
      "smoke azdo: skipped network-blocked",
      "smoke bifrost: skipped azdo-failed",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("formatted lines of a blocked probe leak no host, URL, key, body or error text (AC-6)", async () => {
  const fake = makeFetch(({ url }) => {
    if (url === "https://bifrost.yourcompany.internal/") {
      return new Response(`${BODY_CANARY} ${KEY}`, { status: 403 });
    }
    if (isProbeUrl(url)) return new Response("", { status: 200 });
    return azdoJson(SHARED_OK);
  });
  const report = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
  const dump = formatSmoke(report).join("\n");
  for (const forbidden of [KEY, BODY_CANARY, PAT, "bifrost.yourcompany.internal", "dev.azure.com", "https://"]) {
    assert.equal(dump.includes(forbidden), false, forbidden);
  }
  const azdoBlocked = await runSmoke(VALUES, KEY, {
    env: {},
    fetch: makeFetch(() => new Response("", { status: 407 })).fn,
  });
  assert.deepEqual(azdoBlocked.network, { status: "fail", codes: ["azdo-blocked"] });
  assert.equal(formatSmoke(azdoBlocked).join("\n").includes("dev.azure.com"), false);
});

test("formatSmoke prints fail internal for a hostile or missing report.network and never throws", () => {
  const base = { azdo: { status: "pass" }, bifrost: { status: "pass" } };
  for (const network of [undefined, null, 42, {}, { status: "fail" }, { status: "fail", codes: [] }, { status: "fail", codes: [1] }]) {
    const report = { ...base, network } as unknown as SmokeReport;
    const lines = formatSmoke(report);
    assert.equal(lines[0], "smoke network: fail internal", JSON.stringify(network));
    assert.equal(lines.length, 3);
    assert.equal(smokeFailed(report), true);
  }
});

test("formatSmoke joins network codes with a comma and no space", () => {
  const report: SmokeReport = {
    network: { status: "fail", codes: ["azdo-blocked", "bifrost-timeout"] },
    azdo: { status: "skipped", code: "network-blocked" },
    bifrost: { status: "skipped", code: "network-blocked" },
  };
  assert.equal(formatSmoke(report)[0], "smoke network: fail azdo-blocked,bifrost-timeout");
});

test("network hint is identical for both front ends except the script name (AC-7)", () => {
  const blocked: SmokeReport = {
    network: { status: "fail", codes: ["bifrost-blocked"] },
    azdo: { status: "pass" },
    bifrost: { status: "skipped", code: "network-blocked" },
  };
  const sh = formatSmoke(blocked, "install.sh");
  const ps = formatSmoke(blocked, "install.ps1");
  assert.deepEqual(
    sh,
    ps.map((line) => line.replace("install.ps1", "install.sh")),
  );
  assert.equal(sh[3], HINT_SH);
  assert.equal(ps[3], HINT_SH.replace("install.sh", "install.ps1"));
});

test("runSmoke enforces KILO_AZDO_TIMEOUT_MS deadline on hanging authenticated AzDO and hanging authenticated Bifrost", async () => {
  const waitAbort = (signal: AbortSignal) =>
    new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error(ERR_CANARY)), { once: true });
    });

  const t0 = Date.now();
  let azdoSignal: AbortSignal | undefined;
  const azdoHang = makeFetch(({ url, init }) => {
    if (isProbeUrl(url)) return new Response("", { status: 404 });
    azdoSignal = init.signal;
    return waitAbort(init.signal);
  });
  const r1 = await runSmoke(VALUES, KEY, {
    env: { AZDO_PAT: PAT, KILO_AZDO_TIMEOUT_MS: "50" },
    fetch: azdoHang.fn,
  });
  assert.deepEqual(r1, {
    network: PASS_NET,
    azdo: { status: "fail", code: "timeout" },
    bifrost: { status: "skipped", code: "azdo-failed" },
  });
  assert.equal(azdoSignal?.aborted, true);
  assert.ok(Date.now() - t0 < 2000);
  assertNoLeak(r1);
  assert.deepEqual(formatSmoke(r1), [
    "smoke network: pass",
    "smoke azdo: fail timeout",
    "smoke bifrost: skipped azdo-failed",
    HINT_SH,
  ]);

  const t1 = Date.now();
  let bifrostSignal: AbortSignal | undefined;
  const bifrostHang = makeFetch(({ url, init }) => {
    if (isProbeUrl(url)) return new Response("", { status: 404 });
    if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
    bifrostSignal = init.signal;
    return waitAbort(init.signal);
  });
  const r2 = await runSmoke(VALUES, KEY, {
    env: { AZDO_PAT: PAT, KILO_AZDO_TIMEOUT_MS: "50" },
    fetch: bifrostHang.fn,
  });
  assert.deepEqual(r2, {
    network: PASS_NET,
    azdo: { status: "pass" },
    bifrost: { status: "fail", code: "timeout" },
  });
  assert.equal(bifrostSignal?.aborted, true);
  assert.ok(Date.now() - t1 < 2000);
  assertNoLeak(r2);
  assert.deepEqual(formatSmoke(r2), [
    "smoke network: pass",
    "smoke azdo: pass",
    "smoke bifrost: fail timeout",
    HINT_SH,
  ]);
});

test("runSmoke maps throwing authenticated fetch to network-unreachable (azdo) and network (bifrost) without leaking error messages", async () => {
  const azdoThrow = makeFetch(({ url }) => {
    if (isProbeUrl(url)) return new Response("", { status: 404 });
    throw new Error(`${ERR_CANARY} ${PAT}`);
  });
  const r1 = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: azdoThrow.fn });
  assert.deepEqual(r1, {
    network: PASS_NET,
    azdo: { status: "fail", code: "network-unreachable" },
    bifrost: { status: "skipped", code: "azdo-failed" },
  });
  assertNoLeak(r1);
  assert.deepEqual(formatSmoke(r1), [
    "smoke network: pass",
    "smoke azdo: fail network-unreachable",
    "smoke bifrost: skipped azdo-failed",
    HINT_SH,
  ]);

  const bifrostThrow = makeFetch(({ url }) => {
    if (isProbeUrl(url)) return new Response("", { status: 404 });
    if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
    return Promise.reject(new Error(`${ERR_CANARY} ${KEY}`));
  });
  const r2 = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: bifrostThrow.fn });
  assert.deepEqual(r2, {
    network: PASS_NET,
    azdo: { status: "pass" },
    bifrost: { status: "fail", code: "network" },
  });
  assertNoLeak(r2);
  assert.deepEqual(formatSmoke(r2), [
    "smoke network: pass",
    "smoke azdo: pass",
    "smoke bifrost: fail network",
    HINT_SH,
  ]);
});

test("runSmoke enforces 1 MiB response cap and JSON-object body requirement on Bifrost", async () => {
  const declared2Mib = makeFetch(({ url }) => {
    if (isProbeUrl(url)) return new Response("", { status: 404 });
    if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
    return new Response("{}", { status: 200, headers: { "content-length": String(2 * MIB) } });
  });
  const rDeclared = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: declared2Mib.fn });
  assert.deepEqual(rDeclared, {
    network: PASS_NET,
    azdo: { status: "pass" },
    bifrost: { status: "fail", code: "too-large" },
  });

  const streamedOverCap = makeFetch(({ url }) => {
    if (isProbeUrl(url)) return new Response("", { status: 404 });
    if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MIB).fill(0x61));
        controller.enqueue(new Uint8Array([0x61]));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  });
  const rStreamed = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: streamedOverCap.fn });
  assert.deepEqual(rStreamed, {
    network: PASS_NET,
    azdo: { status: "pass" },
    bifrost: { status: "fail", code: "too-large" },
  });

  for (const badBody of [`<html>${BODY_CANARY}</html>`, `["${BODY_CANARY}"]`, `"${BODY_CANARY}"`, "null"]) {
    const fake = makeFetch(({ url }) => {
      if (isProbeUrl(url)) return new Response("", { status: 404 });
      if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
      return new Response(badBody, { status: 200 });
    });
    const rBad = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(rBad, {
      network: PASS_NET,
      azdo: { status: "pass" },
      bifrost: { status: "fail", code: "bad-response" },
    });
    assertNoLeak(rBad);
  }
});

test("runSmoke reads globalThis.fetch at call time, ignores __proto__ baseURL and never rejects on hostile deps", async () => {
  const originalFetch = globalThis.fetch;
  const seenUrls: string[] = [];
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      seenUrls.push(url);
      if (isProbeUrl(url)) return new Response("", { status: 200 });
      if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
      return new Response(MODELS_OK, { status: 200 });
    }) as typeof globalThis.fetch;

    const rGlobal = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT } });
    assert.deepEqual(rGlobal, { network: PASS_NET, azdo: { status: "pass" }, bifrost: { status: "pass" } });
    assert.equal(seenUrls.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const protoPayload = '{"__proto":{"x":1},"__proto__":{"provider":{"bifrost":{"options":{"baseURL":"https://evil.example/v1"}}}}}';
  const protoFetch = makeFetch(({ url }) => (isProbeUrl(url) ? new Response("", { status: 200 }) : azdoJson(protoPayload)));
  const rProto = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: protoFetch.fn });
  assert.deepEqual(rProto, {
    network: PASS_NET,
    azdo: { status: "pass" },
    bifrost: { status: "fail", code: "no-base-url" },
  });
  assert.equal(protoFetch.calls.length, 2);

  // Hostile deps with non-function fetch/runAz: nothing real (fetch, az) may be reached.
  const guardCalls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    guardCalls.push(String(input));
    throw new Error("real fetch must not be used");
  }) as typeof globalThis.fetch;
  try {
    const rHostile = await runSmoke(VALUES, KEY, { env: {}, fetch: 42, runAz: 42 } as unknown as SmokeDeps);
    assert.deepEqual(rHostile, {
      network: { status: "fail", codes: ["internal"] },
      azdo: { status: "skipped", code: "network-blocked" },
      bifrost: { status: "skipped", code: "azdo-failed" },
    });
    assert.equal(guardCalls.length, 0);
    assert.equal(smokeFailed(rHostile), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("formatSmoke names the front end in the no-key hint", () => {
  const noKeyReport: SmokeReport = {
    network: PASS_NET,
    azdo: { status: "pass" },
    bifrost: { status: "skipped", code: "no-key" },
  };
  assert.equal(
    formatSmoke(noKeyReport, "install.ps1")[3],
    "Smoke test: set KILO_BIFROST_KEY and re-run install.ps1 to check your Bifrost virtual key.",
  );
  assert.equal(
    formatSmoke(noKeyReport, "install.sh")[3],
    "Smoke test: set KILO_BIFROST_KEY and re-run install.sh to check your Bifrost virtual key.",
  );
});

test("F-021 AC-7a / T-035: a plugin-side network failure after a passing pre-flight prints exactly one network hint", async () => {
  const cases: Array<[() => unknown, string]> = [
    [() => Promise.reject(new Error(`${ERR_CANARY} ${PAT}`)), "network-unreachable"],
    [
      () => new Response(`<html>${BODY_CANARY}</html>`, { status: 403, headers: { "content-type": "text/html" } }),
      "network-blocked",
    ],
  ];
  for (const [items, code] of cases) {
    const fake = makeFetch(({ url }) => (isProbeUrl(url) ? new Response("", { status: 302 }) : items()));
    const report = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(formatSmoke(report), [
      "smoke network: pass",
      `smoke azdo: fail ${code}`,
      "smoke bifrost: skipped azdo-failed",
      HINT_SH,
    ]);
    assert.equal(formatSmoke(report).filter((l) => l === HINT_SH).length, 1);
    assert.equal(smokeFailed(report), true);
    assertNoLeak(report);
  }
});

const HINT_PS = HINT_SH.replace("install.sh", "install.ps1");
const countHints = (lines: string[]): number =>
  lines.filter((l) => l.startsWith("Smoke test: a network check failed")).length;

test("T-035 AC-1: azdo network-unreachable, network-blocked and timeout print the hint last, once", () => {
  for (const code of ["network-unreachable", "network-blocked", "timeout"]) {
    const report: SmokeReport = {
      network: PASS_NET,
      azdo: { status: "fail", code },
      bifrost: { status: "skipped", code: "azdo-failed" },
    };
    const expected = ["smoke network: pass", `smoke azdo: fail ${code}`, "smoke bifrost: skipped azdo-failed"];
    assert.deepEqual(formatSmoke(report), [...expected, HINT_SH], code);
    assert.deepEqual(formatSmoke(report, "install.ps1"), [...expected, HINT_PS], code);
  }
  const quiet = [
    "http-401", "http-403", "http-404", "auth-unavailable", "invalid-settings", "network",
    "bad-response", "too-large", "invalid-jsonc", "invalid-shape", "internal",
  ];
  for (const code of quiet) {
    const report: SmokeReport = {
      network: PASS_NET,
      azdo: { status: "fail", code },
      bifrost: { status: "skipped", code: "azdo-failed" },
    };
    assert.equal(formatSmoke(report).length, 3, code);
  }
});

test("T-035 AC-2: bifrost network, timeout, 407 and 470 print the hint; other codes and skipped do not", () => {
  const withBifrost = (bifrost: SmokeReport["bifrost"]): SmokeReport => ({
    network: PASS_NET,
    azdo: { status: "pass" },
    bifrost,
  });
  for (const code of ["network", "timeout", "407", "470"]) {
    assert.deepEqual(formatSmoke(withBifrost({ status: "fail", code })), [
      "smoke network: pass",
      "smoke azdo: pass",
      `smoke bifrost: fail ${code}`,
      HINT_SH,
    ]);
  }
  for (const code of ["401", "403", "404", "500", "bad-response", "invalid-key", "too-large", "no-base-url"]) {
    assert.equal(formatSmoke(withBifrost({ status: "fail", code })).length, 3, code);
  }
  for (const code of ["azdo-failed", "key-reference", "network-blocked"] as const) {
    assert.equal(formatSmoke(withBifrost({ status: "skipped", code })).length, 3, code);
  }
  const noKey = formatSmoke(withBifrost({ status: "skipped", code: "no-key" }));
  assert.equal(noKey.length, 4);
  assert.equal(countHints(noKey), 0);
});

test("T-035 AC-2: runSmoke with an authenticated Bifrost 407 or 470 reports fail and one hint", async () => {
  for (const status of [407, 470]) {
    const fake = makeFetch(({ url }) => {
      if (isProbeUrl(url)) return new Response("", { status: 404 });
      if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
      return new Response(`${BODY_CANARY} ${KEY}`, { status, headers: { "x-canary": BODY_CANARY } });
    });
    const report = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(report, {
      network: PASS_NET,
      azdo: { status: "pass" },
      bifrost: { status: "fail", code: String(status) },
    });
    const lines = formatSmoke(report);
    assert.equal(lines.length, 4);
    assert.equal(lines[3], HINT_SH);
    assert.equal(countHints(lines), 1);
    assertNoLeak(report);
  }
});

test("T-035 AC-3: the hint is printed at most once and in the documented order", () => {
  const passAzdo = { status: "pass" } as const;
  const skipped = { status: "skipped", code: "azdo-failed" } as const;
  const cases: Array<[SmokeReport, number]> = [
    [{ network: { status: "fail", codes: ["azdo-blocked"] }, azdo: { status: "fail", code: "timeout" }, bifrost: skipped }, 1],
    [{ network: { status: "fail", codes: ["bifrost-timeout"] }, azdo: passAzdo, bifrost: { status: "fail", code: "470" } }, 1],
    [{ network: PASS_NET, azdo: { status: "fail", code: "network-blocked" }, bifrost: { status: "fail", code: "407" } }, 1],
    [{ network: { status: "fail", codes: ["internal"] }, azdo: { status: "fail", code: "internal" }, bifrost: skipped }, 0],
    [{ network: { status: "fail", codes: ["internal"] }, azdo: { status: "fail", code: "network-blocked" }, bifrost: skipped }, 1],
  ];
  for (const [report, count] of cases) {
    const lines = formatSmoke(report);
    assert.equal(countHints(lines), count);
    if (count === 1) assert.equal(lines[lines.length - 1], HINT_SH);
  }
  const both = formatSmoke({
    network: { status: "fail", codes: ["bifrost-blocked"] },
    azdo: passAzdo,
    bifrost: { status: "skipped", code: "no-key" },
  });
  assert.equal(both.length, 5);
  assert.ok(both[3]!.startsWith("Smoke test: set KILO_BIFROST_KEY"));
  assert.equal(both[4], HINT_SH);
});

test("T-035 AC-3: non-string codes and statuses are compared exactly and never produce a hint", () => {
  const odd = [
    { status: "fail", code: 470 },
    { status: "fail", code: new String("timeout") },
    { status: "fail", code: { toString: () => "timeout" } },
    { status: new String("fail"), code: "timeout" },
    { status: "skipped", code: "timeout" },
  ];
  for (const outcome of odd) {
    const lines = formatSmoke({ network: PASS_NET, azdo: outcome as never, bifrost: outcome as never });
    assert.equal(countHints(lines), 0, JSON.stringify(outcome));
  }
  const withN1 = formatSmoke({
    network: { status: "fail", codes: ["azdo-blocked"] },
    azdo: odd[0] as never,
    bifrost: { status: "pass" },
  });
  assert.equal(countHints(withN1), 1);
});

test("T-035 AC-4: an anonymous probe answered with HTTP 470 is blocked and the credential is withheld", async () => {
  const fake = makeFetch(
    () =>
      new Response(`Action: Deny. Reason: No rule matched. ${BODY_CANARY}`, {
        status: 470,
        headers: { "content-type": "text/plain", "x-canary": BODY_CANARY },
      }),
  );
  let azCalls = 0;
  const runAz = () => {
    azCalls += 1;
    return Promise.resolve({ exitCode: 0, stdout: TOKEN });
  };
  const report = await runSmoke(VALUES, KEY, { env: {}, fetch: fake.fn, runAz });
  assert.deepEqual(report, {
    network: { status: "fail", codes: ["azdo-blocked"] },
    azdo: { status: "skipped", code: "network-blocked" },
    bifrost: { status: "skipped", code: "azdo-failed" },
  });
  assert.equal(fake.calls.length, 1);
  assert.equal(azCalls, 0);
  assert.equal(smokeFailed(report), true);
  const lines = formatSmoke(report);
  assert.equal(lines.length, 4);
  assert.equal(lines[3], HINT_SH);
  assertNoLeak(report);
});

test("T-035 AC-6: canaries in 470/407 and authenticated network answers never reach the report or lines", async () => {
  const canaryResponse = (status: number) =>
    new Response(`${BODY_CANARY} ${PAT} ${TOKEN} ${KEY}`, {
      status,
      headers: { "x-canary": BODY_CANARY, "content-type": "text/plain" },
    });
  const scenarios: Array<(url: string) => unknown> = [
    () => canaryResponse(470),
    (url) => (isProbeUrl(url) ? new Response("", { status: 404 }) : canaryResponse(407)),
    (url) =>
      isProbeUrl(url) ? new Response("", { status: 404 }) : Promise.reject(new Error(`${ERR_CANARY} ${PAT}`)),
    (url) => {
      if (isProbeUrl(url)) return new Response("", { status: 404 });
      return url.startsWith("https://dev.azure.com/") ? azdoJson(SHARED_OK) : canaryResponse(470);
    },
  ];
  const forbidden = [BODY_CANARY, ERR_CANARY, PAT, TOKEN, KEY, "dev.azure.com", "bifrost.yourcompany", "acme", "kilo-config", "https://"];
  for (const handler of scenarios) {
    const fake = makeFetch(({ url }) => handler(url));
    const report = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assertNoLeak(report);
    const text = formatSmoke(report).join("\n");
    for (const secret of forbidden) assert.equal(text.includes(secret), false, secret);
  }
});

test("runSmoke falls back to provider.azurefoundry baseURL when bifrost declares none, and prefers bifrost when both exist", async () => {
  const fallback = `{"provider":{"azurefoundry":{"options":{"baseURL":"https://gateway.example/v1"}},"bifrost":{"options":{"apiKey":"UNUSED"}}}}`;
  const both = `{"provider":{"azurefoundry":{"options":{"baseURL":"https://other.example/v1"}},"bifrost":{"options":{"baseURL":"https://gateway.example/v1"}}}}`;
  for (const content of [fallback, both]) {
    const fake = makeFetch(({ url }) => {
      if (isProbeUrl(url)) return new Response("", { status: 200 });
      if (url.startsWith("https://dev.azure.com/")) return azdoJson(content);
      return new Response(MODELS_OK, { status: 200 });
    });
    const report = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(report, { network: PASS_NET, azdo: { status: "pass" }, bifrost: { status: "pass" } });
    assert.equal(fake.calls[3]!.url, "https://gateway.example/v1/models");
  }
});

test("storedApiKey prefers the azurefoundry x-bf-vk header over the bifrost apiKey", () => {
  const withHeader = { provider: { azurefoundry: { options: { headers: { "x-bf-vk": "sk-bf-header" } } }, bifrost: { options: { apiKey: "sk-bf-api" } } } };
  assert.equal(storedApiKey(withHeader), "sk-bf-header");
  const apiOnly = { provider: { bifrost: { options: { apiKey: "sk-bf-api" } } } };
  assert.equal(storedApiKey(apiOnly), "sk-bf-api");
});
