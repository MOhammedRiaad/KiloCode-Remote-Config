import assert from "node:assert/strict";
import { test } from "node:test";
import { PLACEHOLDER_KEY } from "../../installer/personal-config-edit.ts";
import type { Values } from "../../installer/personal-config-edit.ts";
import {
  classifyKey,
  formatSmoke,
  modelsUrl,
  pickSmokeEnv,
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
  const dump = `${JSON.stringify(report)}\n${formatSmoke(report).join("\n")}`;
  for (const secret of [KEY, "AbCdEf1234567890", PAT, BASIC_CRED, TOKEN, ERR_CANARY, BODY_CANARY]) {
    assert.equal(dump.includes(secret), false, `leaked ${secret}`);
  }
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

test("formatSmoke and smokeFailed follow contract section 7 and 9", () => {
  const passReport: SmokeReport = { azdo: { status: "pass" }, bifrost: { status: "pass" } };
  assert.deepEqual(formatSmoke(passReport), ["smoke azdo: pass", "smoke bifrost: pass"]);
  assert.equal(smokeFailed(passReport), false);

  const noKeyReport: SmokeReport = {
    azdo: { status: "pass" },
    bifrost: { status: "skipped", code: "no-key" },
  };
  assert.deepEqual(formatSmoke(noKeyReport), [
    "smoke azdo: pass",
    "smoke bifrost: skipped no-key",
    "Smoke test: set KILO_BIFROST_KEY and re-run install.sh to check your Bifrost virtual key.",
  ]);
  assert.equal(smokeFailed(noKeyReport), false);

  const refReport: SmokeReport = {
    azdo: { status: "pass" },
    bifrost: { status: "skipped", code: "key-reference" },
  };
  assert.deepEqual(formatSmoke(refReport), ["smoke azdo: pass", "smoke bifrost: skipped key-reference"]);
  assert.equal(smokeFailed(refReport), false);

  const failReport: SmokeReport = {
    azdo: { status: "fail", code: "http-404" },
    bifrost: { status: "skipped", code: "azdo-failed" },
  };
  assert.deepEqual(formatSmoke(failReport), ["smoke azdo: fail http-404", "smoke bifrost: skipped azdo-failed"]);
  assert.equal(smokeFailed(failReport), true);
});

test("runSmoke happy path: one AzDO call and one Bifrost call with exact URL, headers and redirect manual", async () => {
  let azCalled = false;
  const fake = makeFetch(({ url }) => {
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
  assert.deepEqual(report, { azdo: { status: "pass" }, bifrost: { status: "pass" } });
  assert.equal(azCalled, false);
  assert.equal(fake.calls.length, 2);

  const azdoCall = fake.calls[0]!;
  assert.equal(
    azdoCall.url,
    "https://dev.azure.com/acme/platform/_apis/git/repositories/kilo-config/items?path=%2Fkilo.jsonc&versionDescriptor.version=main&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1",
  );
  assert.equal(azdoCall.init.redirect, "manual");
  assert.equal(azdoCall.init.headers["Authorization"], `Basic ${BASIC_CRED}`);
  assert.equal(JSON.stringify(azdoCall.init.headers).includes(KEY), false);

  const bifrostCall = fake.calls[1]!;
  assert.equal(bifrostCall.url, "https://bifrost.yourcompany.internal/v1/models");
  assert.equal(bifrostCall.init.method, "GET");
  assert.equal(bifrostCall.init.redirect, "manual");
  assert.deepEqual(bifrostCall.init.headers, {
    Accept: "application/json",
    Authorization: `Bearer ${KEY}`,
  });
  assertNoLeak(report);
});

test("runSmoke uses az token for AzDO when no PAT is set and never sends token to Bifrost (AC-5)", async () => {
  let azCalls = 0;
  const fake = makeFetch(({ url }) => {
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
  assert.deepEqual(report, { azdo: { status: "pass" }, bifrost: { status: "pass" } });
  assert.equal(azCalls, 1);
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[0]!.init.headers["Authorization"], `Bearer ${TOKEN}`);
  assert.deepEqual(fake.calls[1]!.init.headers, {
    Accept: "application/json",
    Authorization: `Bearer ${KEY}`,
  });
  assert.equal(JSON.stringify(fake.calls[1]!.init.headers).includes(TOKEN), false);
  assertNoLeak(report);
});

test("runSmoke reports bare HTTP status on Bifrost non-2xx (401, 302) without following redirects", async () => {
  for (const status of [401, 302]) {
    const fake = makeFetch(({ url }) => {
      if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
      return new Response(BODY_CANARY, { status, headers: { location: "http://evil.example/models" } });
    });
    const report = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(report, {
      azdo: { status: "pass" },
      bifrost: { status: "fail", code: String(status) },
    });
    assert.equal(fake.calls.length, 2);
    assertNoLeak(report);
  }
});

test("runSmoke skips Bifrost when AzDO fails (http-404, invalid-jsonc, invalid-shape)", async () => {
  const cases: Array<[Response, string]> = [
    [new Response(BODY_CANARY, { status: 404 }), "http-404"],
    [azdoJson(`{ "broken": "${BODY_CANARY}`), "invalid-jsonc"],
    [azdoJson(`["${BODY_CANARY}"]`), "invalid-shape"],
  ];
  for (const [azdoResponse, expectedCode] of cases) {
    const fake = makeFetch(() => azdoResponse);
    const report = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(report, {
      azdo: { status: "fail", code: expectedCode },
      bifrost: { status: "skipped", code: "azdo-failed" },
    });
    assert.equal(fake.calls.length, 1);
    assertNoLeak(report);
  }
});

test("runSmoke never calls Bifrost when baseURL is missing, insecure or invalid, or key is skipped/invalid", async () => {
  const badConfigs: Array<[string, string]> = [
    ["{}", "no-base-url"],
    ['{"provider":[]}', "no-base-url"],
    ['{"provider":{"bifrost":{"options":{"baseURL":123}}}}', "no-base-url"],
    ['{"provider":{"bifrost":{"options":{"baseURL":"http://bifrost.internal/v1"}}}}', "insecure-base-url"],
    ['{"provider":{"bifrost":{"options":{"baseURL":"https://h/v1?x=1"}}}}', "invalid-base-url"],
  ];
  for (const [content, code] of badConfigs) {
    const fake = makeFetch(() => azdoJson(content));
    const report = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(report, {
      azdo: { status: "pass" },
      bifrost: { status: "fail", code },
    });
    assert.equal(fake.calls.length, 1);
  }

  for (const [keyInput, expected] of [
    [PLACEHOLDER_KEY, { status: "skipped", code: "no-key" }],
    ["{env:MY_KEY}", { status: "skipped", code: "key-reference" }],
    ["bad key", { status: "fail", code: "invalid-key" }],
  ] as const) {
    const fake = makeFetch(() => azdoJson(SHARED_OK));
    const report = await runSmoke(VALUES, keyInput, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(report, { azdo: { status: "pass" }, bifrost: expected });
    assert.equal(fake.calls.length, 1);
  }
});

test("runSmoke enforces KILO_AZDO_TIMEOUT_MS deadline on hanging AzDO and hanging Bifrost", async () => {
  const waitAbort = (signal: AbortSignal) =>
    new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error(ERR_CANARY)), { once: true });
    });

  const t0 = Date.now();
  let azdoSignal: AbortSignal | undefined;
  const azdoHang = makeFetch(({ init }) => {
    azdoSignal = init.signal;
    return waitAbort(init.signal);
  });
  const r1 = await runSmoke(VALUES, KEY, {
    env: { AZDO_PAT: PAT, KILO_AZDO_TIMEOUT_MS: "50" },
    fetch: azdoHang.fn,
  });
  assert.deepEqual(r1, {
    azdo: { status: "fail", code: "timeout" },
    bifrost: { status: "skipped", code: "azdo-failed" },
  });
  assert.equal(azdoSignal?.aborted, true);
  assert.ok(Date.now() - t0 < 2000);
  assertNoLeak(r1);

  const t1 = Date.now();
  let bifrostSignal: AbortSignal | undefined;
  const bifrostHang = makeFetch(({ url, init }) => {
    if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
    bifrostSignal = init.signal;
    return waitAbort(init.signal);
  });
  const r2 = await runSmoke(VALUES, KEY, {
    env: { AZDO_PAT: PAT, KILO_AZDO_TIMEOUT_MS: "50" },
    fetch: bifrostHang.fn,
  });
  assert.deepEqual(r2, {
    azdo: { status: "pass" },
    bifrost: { status: "fail", code: "timeout" },
  });
  assert.equal(bifrostSignal?.aborted, true);
  assert.ok(Date.now() - t1 < 2000);
  assertNoLeak(r2);
});

test("runSmoke maps throwing fetch to network without leaking error messages", async () => {
  const azdoThrow = makeFetch(() => {
    throw new Error(`${ERR_CANARY} ${PAT}`);
  });
  const r1 = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: azdoThrow.fn });
  assert.deepEqual(r1, {
    azdo: { status: "fail", code: "network" },
    bifrost: { status: "skipped", code: "azdo-failed" },
  });
  assertNoLeak(r1);

  const bifrostThrow = makeFetch(({ url }) => {
    if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
    return Promise.reject(new Error(`${ERR_CANARY} ${KEY}`));
  });
  const r2 = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: bifrostThrow.fn });
  assert.deepEqual(r2, {
    azdo: { status: "pass" },
    bifrost: { status: "fail", code: "network" },
  });
  assertNoLeak(r2);
});

test("runSmoke enforces 1 MiB response cap and JSON-object body requirement on Bifrost", async () => {
  const declared2Mib = makeFetch(({ url }) => {
    if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
    return new Response("{}", { status: 200, headers: { "content-length": String(2 * MIB) } });
  });
  const rDeclared = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: declared2Mib.fn });
  assert.deepEqual(rDeclared, {
    azdo: { status: "pass" },
    bifrost: { status: "fail", code: "too-large" },
  });

  const streamedOverCap = makeFetch(({ url }) => {
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
    azdo: { status: "pass" },
    bifrost: { status: "fail", code: "too-large" },
  });

  for (const badBody of [`<html>${BODY_CANARY}</html>`, `["${BODY_CANARY}"]`, `"${BODY_CANARY}"`, "null"]) {
    const fake = makeFetch(({ url }) => {
      if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
      return new Response(badBody, { status: 200 });
    });
    const rBad = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: fake.fn });
    assert.deepEqual(rBad, {
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
      if (url.startsWith("https://dev.azure.com/")) return azdoJson(SHARED_OK);
      return new Response(MODELS_OK, { status: 200 });
    }) as typeof globalThis.fetch;

    const rGlobal = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT } });
    assert.deepEqual(rGlobal, { azdo: { status: "pass" }, bifrost: { status: "pass" } });
    assert.equal(seenUrls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const protoPayload = '{"__proto":{"x":1},"__proto__":{"provider":{"bifrost":{"options":{"baseURL":"https://evil.example/v1"}}}}}';
  const protoFetch = makeFetch(() => azdoJson(protoPayload));
  const rProto = await runSmoke(VALUES, KEY, { env: { AZDO_PAT: PAT }, fetch: protoFetch.fn });
  assert.deepEqual(rProto, {
    azdo: { status: "pass" },
    bifrost: { status: "fail", code: "no-base-url" },
  });
  assert.equal(protoFetch.calls.length, 1);

  // Hostile deps with non-function fetch/runAz: nothing real (fetch, az) may be reached.
  const guardCalls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    guardCalls.push(String(input));
    throw new Error("real fetch must not be used");
  }) as typeof globalThis.fetch;
  try {
    const rHostile = await runSmoke(VALUES, KEY, { env: {}, fetch: 42, runAz: 42 } as unknown as SmokeDeps);
    assert.equal(rHostile.azdo.status, "fail");
    assert.deepEqual(rHostile.bifrost, { status: "skipped", code: "azdo-failed" });
    assert.equal(guardCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("formatSmoke names the front end in the no-key hint", () => {
  const noKeyReport: SmokeReport = { azdo: { status: "pass" }, bifrost: { status: "skipped", code: "no-key" } };
  assert.equal(
    formatSmoke(noKeyReport, "install.ps1")[2],
    "Smoke test: set KILO_BIFROST_KEY and re-run install.ps1 to check your Bifrost virtual key.",
  );
  assert.equal(
    formatSmoke(noKeyReport, "install.sh")[2],
    "Smoke test: set KILO_BIFROST_KEY and re-run install.sh to check your Bifrost virtual key.",
  );
});
