import assert from "node:assert/strict";
import { test } from "node:test";
import { __internals } from "../../plugin/azdo-remote-config.ts";

// Only fake fetch and fake runAz are used here: no network, no real az, no child process.

const { fetchRemoteConfig, resolveSettings } = __internals;

type Env = Record<string, string | undefined>;
type Handler = (url: string, init: Init) => unknown;

interface Init {
  method: string;
  headers: Record<string, string>;
  redirect: string;
  signal: AbortSignal;
}

interface Call {
  url: string;
  init: Init;
}

const PAT = "PATSENTINEL1234";
const TOKEN = "tok.SENTINEL-5678";
const MIB = 1048576;
const AZ_ARGS = [
  "account",
  "get-access-token",
  "--resource",
  "499b84ac-1321-427f-aa17-267ca6975798",
  "--query",
  "accessToken",
  "--output",
  "tsv",
];
const BASE = {
  org: "my org",
  project: "plat form",
  repo: "kilo-config",
  path: "/teams/a b/kilo.jsonc",
  branch: "release/1",
};
const EXPECTED_URL =
  "https://dev.azure.com/my%20org/plat%20form/_apis/git/repositories/kilo-config/items" +
  "?path=%2Fteams%2Fa%20b%2Fkilo.jsonc&versionDescriptor.version=release%2F1" +
  "&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1";

function basic(pat: string): string {
  return `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
}

function recordingFetch(handler: Handler) {
  const calls: Call[] = [];
  const fn = (url: string, init: Init): unknown => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fn };
}

function okJson(content: string): Response {
  return new Response(JSON.stringify({ content }), { status: 200 });
}

function azSpy(result: unknown) {
  const calls: Array<{ args: readonly string[]; options: unknown }> = [];
  const fn = (args: readonly string[], options: unknown): unknown => {
    calls.push({ args, options });
    return typeof result === "function" ? (result as () => unknown)() : Promise.resolve(result);
  };
  return { calls, fn };
}

function forbiddenAz() {
  return azSpy(() => assert.fail("runAz must not be called"));
}

function fakeTimers() {
  const delays: number[] = [];
  const state = { cleared: 0 };
  return {
    delays,
    state,
    setTimeout: (_cb: () => void, ms: number): number => {
      delays.push(ms);
      return 7;
    },
    clearTimeout: (): void => {
      state.cleared++;
    },
  };
}

async function guarded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("did not resolve within 3 s")), 3000);
  });
  try {
    return await Promise.race([promise, guard]);
  } finally {
    clearTimeout(timer);
  }
}

function assertNoLeak(result: unknown): void {
  const text = JSON.stringify(result);
  for (const secret of [PAT, TOKEN, Buffer.from(`:${PAT}`).toString("base64"), "boom"]) {
    assert.equal(text.includes(secret), false, `result leaks ${secret}`);
  }
}

function patSettings(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...BASE, pat: PAT, ...extra };
}

function sizedBody(totalBytes: number): Uint8Array<ArrayBuffer> {
  const prefix = '{"content":"';
  const suffix = '"}';
  const filler = "a".repeat(totalBytes - prefix.length - suffix.length);
  const bytes = new Uint8Array(totalBytes);
  bytes.set(new TextEncoder().encode(prefix + filler + suffix));
  return bytes;
}

function countingStream(next: (pull: number) => Uint8Array | undefined) {
  const state = { pulls: 0 };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulls++;
        const chunk = next(state.pulls);
        if (chunk === undefined) controller.close();
        else controller.enqueue(chunk);
      },
    },
    { highWaterMark: 0 },
  );
  return { state, stream };
}

function neverStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) }, { highWaterMark: 0 });
}

// ---- AC-1: URL, init and headers ----

test("AC-1: exact URL, init and header keys; text is returned unchanged", async () => {
  const jsonc = '// comment\r\n{ "a": 1, /* c */ "b": "café", }\r\n';
  const fake = recordingFetch(() => okJson(jsonc));
  const az = forbiddenAz();
  const result = await fetchRemoteConfig(patSettings(), { fetch: fake.fn, runAz: az.fn, env: {} });
  assert.deepEqual(result, { ok: true, text: jsonc });
  assert.deepEqual(Object.keys(result), ["ok", "text"]);
  assert.equal(fake.calls.length, 1);
  const { url, init } = fake.calls[0]!;
  assert.equal(url, EXPECTED_URL);
  assert.equal(init.method, "GET");
  assert.equal(init.redirect, "manual");
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(init), ["method", "headers", "redirect", "signal"]);
  assert.deepEqual(Object.keys(init.headers), ["Accept", "Authorization", "X-TFS-FedAuthRedirect"]);
  assert.equal(init.headers.Accept, "application/json");
  assert.equal(init.headers["X-TFS-FedAuthRedirect"], "Suppress");
  assert.equal(az.calls.length, 0);
});

test("AC-1: settings produced by resolveSettings work; percent-encoding covers reserved characters", async () => {
  const { settings } = resolveSettings(
    { org: "o&r", project: "p+q", repo: "r=s", path: "/d/é x.jsonc", branch: "feat/ü", pat: PAT },
    { env: {} },
  );
  const fake = recordingFetch(() => okJson("{}"));
  const result = await fetchRemoteConfig(settings, { fetch: fake.fn, env: {} });
  assert.deepEqual(result, { ok: true, text: "{}" });
  assert.equal(
    fake.calls[0]!.url,
    "https://dev.azure.com/o%26r/p%2Bq/_apis/git/repositories/r%3Ds/items?path=%2Fd%2F%C3%A9%20x.jsonc" +
      "&versionDescriptor.version=feat%2F%C3%BC&versionDescriptor.versionType=branch&includeContent=true&api-version=7.1",
  );
});

test("AC-1: an empty content string is returned as is", async () => {
  const result = await fetchRemoteConfig(patSettings(), { fetch: () => okJson(""), env: {} });
  assert.deepEqual(result, { ok: true, text: "" });
});

// ---- AC-2: PAT order and skip rules ----

async function authFor(settings: unknown, env: unknown): Promise<string | undefined> {
  const fake = recordingFetch(() => okJson("x"));
  const az = forbiddenAz();
  const result = await fetchRemoteConfig(settings, { fetch: fake.fn, runAz: az.fn, env });
  assert.equal(result.ok, true);
  assert.equal(az.calls.length, 0);
  return fake.calls[0]?.init.headers.Authorization;
}

test("AC-2: settings.pat beats AZDO_PAT beats AZURE_DEVOPS_EXT_PAT", async () => {
  const env: Env = { AZDO_PAT: "from-azdo", AZURE_DEVOPS_EXT_PAT: "from-ext" };
  assert.equal(await authFor({ ...BASE, pat: "from-settings" }, env), basic("from-settings"));
  assert.equal(await authFor({ ...BASE }, env), basic("from-azdo"));
  assert.equal(await authFor({ ...BASE }, { AZURE_DEVOPS_EXT_PAT: "from-ext" }), basic("from-ext"));
});

test("AC-2: empty and whitespace-only values are skipped", async () => {
  assert.equal(await authFor({ ...BASE, pat: "   " }, { AZDO_PAT: "", AZURE_DEVOPS_EXT_PAT: "ext" }), basic("ext"));
  assert.equal(await authFor({ ...BASE, pat: "" }, { AZDO_PAT: " \t ", AZURE_DEVOPS_EXT_PAT: "ext" }), basic("ext"));
  assert.equal(await authFor({ ...BASE, pat: 5 }, { AZDO_PAT: "az" }), basic("az"));
});

test("AC-2: values with CR/LF, a space or non-ASCII are skipped", async () => {
  for (const bad of ["ab\r\ncd", "ab cd", "pät", "a\u0000b", "a\u007fb", "\ud800"]) {
    assert.equal(await authFor({ ...BASE, pat: bad }, { AZDO_PAT: "next" }), basic("next"), JSON.stringify(bad));
    assert.equal(
      await authFor({ ...BASE }, { AZDO_PAT: bad, AZURE_DEVOPS_EXT_PAT: "last" }),
      basic("last"),
      JSON.stringify(bad),
    );
  }
});

test("AC-2: a trimmed PAT is used", async () => {
  assert.equal(await authFor({ ...BASE, pat: "  abc123\r\n" }, {}), basic("abc123"));
  assert.equal(await authFor({ ...BASE }, { AZDO_PAT: "\tzz9 " }), basic("zz9"));
});

test("AC-2: inherited and accessor env values are ignored", async () => {
  const inherited = Object.create({ AZDO_PAT: "inherited" }) as Env;
  inherited.AZURE_DEVOPS_EXT_PAT = "own-ext";
  assert.equal(await authFor({ ...BASE }, inherited), basic("own-ext"));
  const reads = { count: 0 };
  const accessor: Env = { AZURE_DEVOPS_EXT_PAT: "own-ext" };
  Object.defineProperty(accessor, "AZDO_PAT", {
    enumerable: true,
    get() {
      reads.count++;
      return "from-getter";
    },
  });
  assert.equal(await authFor({ ...BASE }, accessor), basic("own-ext"));
  assert.equal(reads.count, 0);
});

test("AC-2: a non-enumerable settings.pat (as produced by resolveSettings) is used", async () => {
  const { settings } = resolveSettings({ ...BASE, pat: "np-1" }, { env: {} });
  assert.equal(Object.keys(settings).includes("pat"), false);
  assert.equal(await authFor(settings, {}), basic("np-1"));
});

// ---- AC-3: az fallback ----

const NO_PAT_ENV: Env = {};

test("AC-3: without a PAT, runAz is called once with the constant args and the token becomes a Bearer", async () => {
  const fake = recordingFetch(() => okJson("x"));
  const az = azSpy({ exitCode: 0, stdout: `  ${TOKEN}\r\n` });
  const result = await fetchRemoteConfig({ ...BASE }, { fetch: fake.fn, runAz: az.fn, env: NO_PAT_ENV });
  assert.deepEqual(result, { ok: true, text: "x" });
  assert.equal(az.calls.length, 1);
  assert.deepEqual(az.calls[0]!.args, AZ_ARGS);
  assert.deepEqual(az.calls[0]!.args.slice(0, 4), AZ_ARGS.slice(0, 4));
  assert.deepEqual(az.calls[0]!.options, { timeoutMs: 5000 });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0]!.init.headers.Authorization, `Bearer ${TOKEN}`);
});

test("AC-3: token68 padding and every allowed character are accepted", async () => {
  const token = "AZaz09-._~+/abc==";
  const fake = recordingFetch(() => okJson("x"));
  const az = azSpy({ exitCode: 0, stdout: token });
  await fetchRemoteConfig({ ...BASE }, { fetch: fake.fn, runAz: az.fn, env: NO_PAT_ENV });
  assert.equal(fake.calls[0]!.init.headers.Authorization, `Bearer ${token}`);
});

const AZ_FAILURES: Array<[string, unknown]> = [
  ["runner throws synchronously", null],
  ["runner rejects", () => Promise.reject(new Error("rejected tok.SENTINEL-5678"))],
  ["exit code 1", { exitCode: 1, stdout: TOKEN }],
  ["exit code null", { exitCode: null, stdout: TOKEN }],
  ["exit code as string", { exitCode: "0", stdout: TOKEN }],
  ["empty stdout", { exitCode: 0, stdout: "" }],
  ["blank stdout", { exitCode: 0, stdout: "  " }],
  ["stdout not a string", { exitCode: 0, stdout: 5 }],
  ["inner space", { exitCode: 0, stdout: "tok en" }],
  ["inner CR LF", { exitCode: 0, stdout: "tok\r\nen" }],
  ["header injection attempt", { exitCode: 0, stdout: "tok\r\nX-Evil: 1" }],
  ["padding only", { exitCode: 0, stdout: "====" }],
  ["too long", { exitCode: 0, stdout: "a".repeat(16385) }],
  ["non-object result", 5],
  ["null result", null],
  ["array result", []],
];

for (const [name, result] of AZ_FAILURES) {
  test(`AC-3: az failure (${name}) gives auth-unavailable and no HTTP request`, async () => {
    const fake = recordingFetch(() => okJson("x"));
    const run =
      name === "runner throws synchronously"
        ? (): never => {
            throw new Error("sync PATSENTINEL1234");
          }
        : azSpy(result).fn;
    const out = await guarded(fetchRemoteConfig({ ...BASE }, { fetch: fake.fn, runAz: run, env: NO_PAT_ENV }));
    assert.deepEqual(out, { ok: false, error: "auth-unavailable" });
    assert.equal(fake.calls.length, 0);
    assertNoLeak(out);
  });
}

test("AC-3: a token of exactly 16384 characters is accepted", async () => {
  const fake = recordingFetch(() => okJson("x"));
  const az = azSpy({ exitCode: 0, stdout: "a".repeat(16384) });
  const out = await fetchRemoteConfig({ ...BASE }, { fetch: fake.fn, runAz: az.fn, env: NO_PAT_ENV });
  assert.equal(out.ok, true);
});

test("AC-3: a runner that never settles hits the deadline (50 ms) and sends no request", async () => {
  const fake = recordingFetch(() => okJson("x"));
  const az = azSpy(() => new Promise(() => {}));
  const started = Date.now();
  const out = await guarded(
    fetchRemoteConfig({ ...BASE, timeoutMs: 50 }, { fetch: fake.fn, runAz: az.fn, env: NO_PAT_ENV }),
  );
  assert.deepEqual(out, { ok: false, error: "auth-unavailable" });
  assert.ok(Date.now() - started < 2000);
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(az.calls[0]!.options, { timeoutMs: 50 });
});

test("AC-3: runAz null is unavailable and never falls back to a real az", async () => {
  const fake = recordingFetch(() => okJson("x"));
  for (const bad of [null, 5, "az", {}]) {
    const out = await guarded(fetchRemoteConfig({ ...BASE }, { fetch: fake.fn, runAz: bad, env: NO_PAT_ENV }));
    assert.deepEqual(out, { ok: false, error: "auth-unavailable" });
  }
  assert.equal(fake.calls.length, 0);
});

// ---- AC-4: timeout ----

test("AC-4: a fetch that never settles gives timeout and aborts the signal", async () => {
  let signal: AbortSignal | undefined;
  const fake = recordingFetch((_url, init) => {
    signal = init.signal;
    return new Promise(() => {});
  });
  const started = Date.now();
  const out = await guarded(fetchRemoteConfig(patSettings({ timeoutMs: 50 }), { fetch: fake.fn, env: {} }));
  assert.deepEqual(out, { ok: false, error: "timeout" });
  assert.ok(Date.now() - started < 2000);
  assert.equal(signal?.aborted, true);
});

test("AC-4: a body that never delivers a chunk gives timeout", async () => {
  let signal: AbortSignal | undefined;
  const fake = recordingFetch((_url, init) => {
    signal = init.signal;
    return new Response(neverStream(), { status: 200 });
  });
  const out = await guarded(fetchRemoteConfig(patSettings({ timeoutMs: 50 }), { fetch: fake.fn, env: {} }));
  assert.deepEqual(out, { ok: false, error: "timeout" });
  assert.equal(signal?.aborted, true);
});

test("AC-4: a fetch that rejects because of the abort reports timeout", async () => {
  const fake = recordingFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  const out = await guarded(fetchRemoteConfig(patSettings({ timeoutMs: 50 }), { fetch: fake.fn, env: {} }));
  assert.deepEqual(out, { ok: false, error: "timeout" });
});

test("AC-4: the default timeout is 5000 ms and the timer is cleared on success", async () => {
  const { settings } = resolveSettings({ org: "o", project: "p", repo: "r", pat: PAT }, { env: {} });
  const timers = fakeTimers();
  const fake = recordingFetch(() => okJson("x"));
  const out = await fetchRemoteConfig(settings, {
    fetch: fake.fn,
    env: {},
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  assert.equal(out.ok, true);
  assert.deepEqual(timers.delays, [5000]);
  assert.equal(timers.state.cleared, 1);
});

test("AC-4: the configured timeoutMs is used; an out-of-range value falls back to 5000", async () => {
  for (const [given, expected] of [
    [1234, 1234],
    [0, 5000],
    [-5, 5000],
    [1.5, 5000],
    ["50", 5000],
    [2147483648, 5000],
  ] as const) {
    const timers = fakeTimers();
    await fetchRemoteConfig(patSettings({ timeoutMs: given }), {
      fetch: () => okJson("x"),
      env: {},
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    assert.deepEqual(timers.delays, [expected], String(given));
  }
});

test("AC-4: the timer is cleared on failure paths too", async () => {
  const timers = fakeTimers();
  const out = await fetchRemoteConfig(patSettings(), {
    fetch: () => Promise.reject(new Error("x")),
    env: {},
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  assert.deepEqual(out, { ok: false, error: "network" });
  assert.equal(timers.state.cleared, 1);
});

// ---- AC-5: error codes without secrets ----

test("AC-5: http status codes map to http-<status> without secrets", async () => {
  for (const status of [401, 404, 500, 302, 403, 503]) {
    const fake = recordingFetch(() => new Response(`${PAT} ${TOKEN} boom`, { status }));
    const out = await fetchRemoteConfig(patSettings(), { fetch: fake.fn, env: {} });
    assert.deepEqual(out, { ok: false, error: `http-${status}` });
    assertNoLeak(out);
  }
});

test("AC-5: a rejecting or throwing fetch gives network without secrets", async () => {
  const rejecting = await fetchRemoteConfig(patSettings(), {
    fetch: () => Promise.reject(new Error(`boom ${PAT}`)),
    env: {},
  });
  assert.deepEqual(rejecting, { ok: false, error: "network" });
  assertNoLeak(rejecting);
  const throwing = await fetchRemoteConfig(patSettings(), {
    fetch: () => {
      throw new Error(`boom ${PAT}`);
    },
    env: {},
  });
  assert.deepEqual(throwing, { ok: false, error: "network" });
  assertNoLeak(throwing);
});

test("AC-5: an unavailable fetch gives network and does not run az", async () => {
  const az = forbiddenAz();
  for (const bad of [null, 5, "fetch"]) {
    const out = await fetchRemoteConfig({ ...BASE }, { fetch: bad, runAz: az.fn, env: {} });
    assert.deepEqual(out, { ok: false, error: "network" });
  }
  assert.equal(az.calls.length, 0);
});

test("AC-5: a failed az-token request never leaks the token", async () => {
  const az = azSpy({ exitCode: 0, stdout: TOKEN });
  const out = await fetchRemoteConfig(
    { ...BASE },
    { fetch: () => new Response(TOKEN, { status: 401 }), runAz: az.fn, env: NO_PAT_ENV },
  );
  assert.deepEqual(out, { ok: false, error: "http-401" });
  assertNoLeak(out);
});

// ---- AC-6: size and response shape ----

test("AC-6: a declared Content-Length above 1 MiB gives too-large and the body is never read", async () => {
  const body = countingStream(() => new Uint8Array(10));
  const out = await fetchRemoteConfig(patSettings(), {
    fetch: () => new Response(body.stream, { status: 200, headers: { "content-length": String(MIB + 1) } }),
    env: {},
  });
  assert.deepEqual(out, { ok: false, error: "too-large" });
  assert.equal(body.state.pulls, 0);
});

test("AC-6: a lying or missing Content-Length cannot bypass the streamed cap", async () => {
  for (const headers of [{ "content-length": "10" }, {}] as Array<Record<string, string>>) {
    const out = await fetchRemoteConfig(patSettings(), {
      fetch: () => new Response(sizedBody(MIB + 1), { status: 200, headers }),
      env: {},
    });
    assert.deepEqual(out, { ok: false, error: "too-large" });
  }
});

test("AC-6: an endless stream gives too-large and stops being pulled", async () => {
  const chunk = new Uint8Array(65536);
  const body = countingStream(() => chunk);
  const out = await guarded(
    fetchRemoteConfig(patSettings(), { fetch: () => new Response(body.stream, { status: 200 }), env: {} }),
  );
  assert.deepEqual(out, { ok: false, error: "too-large" });
  assert.ok(body.state.pulls <= 20, `pulls: ${body.state.pulls}`);
});

test("AC-6: an endless stream of empty chunks is rejected without hanging", async () => {
  const body = countingStream(() => new Uint8Array(0));
  const out = await guarded(
    fetchRemoteConfig(patSettings(), { fetch: () => new Response(body.stream, { status: 200 }), env: {} }),
  );
  assert.deepEqual(out, { ok: false, error: "bad-response" });
});

test("AC-6: a body of exactly 1 MiB is accepted", async () => {
  const bytes = sizedBody(MIB);
  assert.equal(bytes.byteLength, MIB);
  const out = await fetchRemoteConfig(patSettings(), {
    fetch: () => new Response(bytes, { status: 200, headers: { "content-length": String(MIB) } }),
    env: {},
  });
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.text.length, MIB - 14);
});

test("AC-6: a multi-chunk body is reassembled", async () => {
  const bytes = new TextEncoder().encode('{"content":"hello wörld"}');
  const parts = [bytes.slice(0, 5), bytes.slice(5, 17), bytes.slice(17)];
  const body = countingStream((pull) => parts[pull - 1]);
  const out = await fetchRemoteConfig(patSettings(), { fetch: () => new Response(body.stream), env: {} });
  assert.deepEqual(out, { ok: true, text: "hello wörld" });
});

function plain(body: BodyInit | null, status = 200): Response {
  return new Response(body, { status });
}

const BAD_RESPONSES: Array<[string, () => unknown]> = [
  ["non-JSON body", () => plain("not json")],
  ["JSON null", () => plain("null")],
  ["JSON array", () => plain("[]")],
  ["empty object", () => plain("{}")],
  ["content not a string", () => plain('{"content":5}')],
  ["content null", () => plain('{"content":null}')],
  ["JSON string", () => plain('"content"')],
  ["invalid UTF-8", () => plain(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]))],
  ["empty body", () => plain("")],
  ["missing body", () => plain(null)],
  ["status 0", () => ({ status: 0, headers: { get: () => null }, body: null })],
  ["non-integer status", () => ({ status: 200.5, headers: { get: () => null }, body: null })],
  ["string status", () => ({ status: "200", headers: { get: () => null }, body: null })],
  ["status 600", () => ({ status: 600, headers: { get: () => null }, body: null })],
  ["body without getReader", () => ({ status: 200, headers: { get: () => null }, body: {} })],
  ["chunk of the wrong type", () => ({ status: 200, headers: { get: () => null }, body: fakeBody("text") })],
];

function fakeBody(chunk: unknown) {
  let delivered = false;
  return {
    getReader: () => ({
      read: () => {
        if (delivered) return Promise.resolve({ done: true, value: undefined });
        delivered = true;
        return Promise.resolve({ done: false, value: chunk });
      },
      cancel: () => Promise.resolve(),
    }),
  };
}

for (const [name, make] of BAD_RESPONSES) {
  test(`AC-6: bad response (${name}) gives bad-response`, async () => {
    const out = await guarded(fetchRemoteConfig(patSettings(), { fetch: () => make(), env: {} }));
    assert.deepEqual(out, { ok: false, error: "bad-response" });
  });
}

test("AC-6: a stream that errors mid-read gives network", async () => {
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error("stream boom"));
    },
  });
  const out = await fetchRemoteConfig(patSettings(), { fetch: () => new Response(stream), env: {} });
  assert.deepEqual(out, { ok: false, error: "network" });
});

// ---- AC-7: invalid settings ----

function throwingEnv(reads: { count: number }): unknown {
  const bump = (): never => {
    reads.count++;
    return assert.fail("env must not be touched");
  };
  return new Proxy({}, { get: bump, getOwnPropertyDescriptor: bump, has: bump, ownKeys: bump });
}

const INVALID_SETTINGS: Array<[string, unknown]> = [
  ["missing org", { ...BASE, org: undefined }],
  ["missing project", { ...BASE, project: undefined }],
  ["missing repo", { ...BASE, repo: undefined }],
  ["empty org", { ...BASE, org: "" }],
  ["padded org", { ...BASE, org: " my org" }],
  ["non-string org", { ...BASE, org: 5 }],
  ["lone high surrogate in org", { ...BASE, org: "\ud800" }],
  ["lone low surrogate in project", { ...BASE, project: "a\udc00" }],
  ["lone surrogate in path", { ...BASE, path: "/x\ud800" }],
  ["lone surrogate in branch", { ...BASE, branch: "b\udbff" }],
  ["slash in org", { ...BASE, org: "a/b" }],
  ["percent in repo", { ...BASE, repo: "a%2e" }],
  ["dot-dot project", { ...BASE, project: ".." }],
  ["path without leading slash", { ...BASE, path: "teams/kilo.jsonc" }],
  ["path with dot-dot segment", { ...BASE, path: "/a/../b" }],
  ["path with query character", { ...BASE, path: "/a?x=1" }],
  ["branch with space", { ...BASE, branch: "a b" }],
  ["branch with dot-dot", { ...BASE, branch: "a..b" }],
  ["control character in org", { ...BASE, org: "a\nb" }],
  ["null settings", null],
  ["number settings", 42],
  ["string settings", "x"],
  ["array settings", []],
  ["undefined settings", undefined],
];

for (const [name, settings] of INVALID_SETTINGS) {
  test(`AC-7: invalid settings (${name}) give invalid-settings and touch nothing`, async () => {
    const fake = recordingFetch(() => okJson("x"));
    const az = forbiddenAz();
    const timers = fakeTimers();
    const reads = { count: 0 };
    const out = await fetchRemoteConfig(settings, {
      fetch: fake.fn,
      runAz: az.fn,
      env: throwingEnv(reads),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    assert.deepEqual(out, { ok: false, error: "invalid-settings" });
    assert.equal(fake.calls.length, 0);
    assert.equal(az.calls.length, 0);
    assert.equal(reads.count, 0);
    assert.deepEqual(timers.delays, []);
    assert.equal(timers.state.cleared, 0);
  });
}

test("AC-7: a getter on settings is never invoked", async () => {
  const reads = { count: 0 };
  const settings = { ...BASE };
  Object.defineProperty(settings, "org", {
    enumerable: true,
    get() {
      reads.count++;
      return "my org";
    },
  });
  const out = await fetchRemoteConfig(settings, { fetch: () => okJson("x"), env: {} });
  assert.deepEqual(out, { ok: false, error: "invalid-settings" });
  assert.equal(reads.count, 0);
});

// ---- AC-8: hostile inputs ----

function throwingProxy(): object {
  const boom = (): never => {
    throw new Error("trap");
  };
  return new Proxy(
    {},
    {
      get: boom,
      has: boom,
      ownKeys: boom,
      getOwnPropertyDescriptor: boom,
      getPrototypeOf: boom,
      set: boom,
      defineProperty: boom,
      deleteProperty: boom,
    },
  );
}

function revokedProxy(): object {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
}

async function withGlobalFetch<T>(replacement: Handler, body: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = replacement as unknown as typeof fetch;
  try {
    return await body();
  } finally {
    globalThis.fetch = original;
  }
}

test("AC-8: hostile deps always resolve (the faked global fetch is used, never the network)", async () => {
  const hostile: unknown[] = [null, 42, "deps", [], throwingProxy(), revokedProxy()];
  for (const deps of hostile) {
    const fake = recordingFetch(() => okJson("viaGlobal"));
    const out = await withGlobalFetch(fake.fn, () => guarded(fetchRemoteConfig(patSettings(), deps)));
    assert.deepEqual(out, { ok: true, text: "viaGlobal" });
    assert.equal(fake.calls.length, 1);
  }
});

test("AC-8: hostile settings always resolve", async () => {
  const fake = recordingFetch(() => okJson("x"));
  for (const settings of [throwingProxy(), revokedProxy()]) {
    const out = await guarded(fetchRemoteConfig(settings, { fetch: fake.fn, env: {} }));
    assert.deepEqual(out, { ok: false, error: "invalid-settings" });
  }
  assert.equal(fake.calls.length, 0);
});

test("AC-8: a throwing env proxy: settings.pat is still used; without it az is used", async () => {
  const fake = recordingFetch(() => okJson("x"));
  const withPat = await guarded(fetchRemoteConfig(patSettings(), { fetch: fake.fn, env: throwingProxy() }));
  assert.equal(withPat.ok, true);
  assert.equal(fake.calls[0]!.init.headers.Authorization, basic(PAT));
  const az = azSpy({ exitCode: 1, stdout: "" });
  const without = await guarded(
    fetchRemoteConfig({ ...BASE }, { fetch: fake.fn, runAz: az.fn, env: throwingProxy() }),
  );
  assert.deepEqual(without, { ok: false, error: "auth-unavailable" });
  assert.equal(az.calls.length, 1);
  const revoked = await guarded(
    fetchRemoteConfig({ ...BASE }, { fetch: fake.fn, runAz: az.fn, env: revokedProxy() }),
  );
  assert.deepEqual(revoked, { ok: false, error: "auth-unavailable" });
});

test("AC-8: odd fetch return values resolve to bad-response or network", async () => {
  for (const value of [undefined, null, 5, "text", {}, []]) {
    const out = await guarded(fetchRemoteConfig(patSettings(), { fetch: () => value, env: {} }));
    assert.deepEqual(out, { ok: false, error: "bad-response" }, String(value));
  }
  const rejects = await guarded(fetchRemoteConfig(patSettings(), { fetch: () => Promise.reject(undefined), env: {} }));
  assert.deepEqual(rejects, { ok: false, error: "network" });
});

test("AC-8: a response whose headers.get or status getter throws still resolves", async () => {
  const headerThrows = {
    status: 200,
    headers: {
      get: (): never => {
        throw new Error("headers PATSENTINEL1234");
      },
    },
    body: plain('{"content":"ok"}').body,
  };
  const out = await guarded(fetchRemoteConfig(patSettings(), { fetch: () => headerThrows, env: {} }));
  assert.deepEqual(out, { ok: true, text: "ok" });
  const statusThrows = {
    get status(): number {
      throw new Error("status");
    },
  };
  const out2 = await guarded(fetchRemoteConfig(patSettings(), { fetch: () => statusThrows, env: {} }));
  assert.deepEqual(out2, { ok: false, error: "bad-response" });
  const cancelThrows = {
    status: 500,
    headers: { get: () => null },
    body: {
      cancel: (): never => {
        throw new Error("cancel");
      },
    },
  };
  const out3 = await guarded(fetchRemoteConfig(patSettings(), { fetch: () => cancelThrows, env: {} }));
  assert.deepEqual(out3, { ok: false, error: "http-500" });
});

test("AC-8: throwing timer functions and a non-function timer injection still resolve", async () => {
  const thrower = (): never => {
    throw new Error("timer");
  };
  const a = await guarded(
    fetchRemoteConfig(patSettings(), { fetch: () => okJson("x"), env: {}, setTimeout: thrower }),
  );
  assert.deepEqual(a, { ok: false, error: "network" });
  const b = await guarded(
    fetchRemoteConfig(patSettings(), {
      fetch: () => okJson("x"),
      env: {},
      clearTimeout: thrower,
    }),
  );
  assert.deepEqual(b, { ok: true, text: "x" });
  const c = await guarded(
    fetchRemoteConfig(patSettings(), { fetch: () => okJson("x"), env: {}, setTimeout: 5, clearTimeout: "x" }),
  );
  assert.deepEqual(c, { ok: true, text: "x" });
});

test("AC-8: inputs are not mutated and frozen inputs work", async () => {
  const settings = patSettings({ timeoutMs: 4000 });
  const env: Env = { AZDO_PAT: "a", AZURE_DEVOPS_EXT_PAT: "b" };
  const deps = { fetch: () => okJson("x"), env };
  const settingsBefore = structuredClone(settings);
  const envBefore = structuredClone(env);
  await fetchRemoteConfig(settings, deps);
  assert.deepEqual(settings, settingsBefore);
  assert.deepEqual(env, envBefore);
  assert.deepEqual(Object.keys(deps), ["fetch", "env"]);
  Object.freeze(settings);
  Object.freeze(env);
  Object.freeze(deps);
  const frozen = await guarded(fetchRemoteConfig(settings, deps));
  assert.deepEqual(frozen, { ok: true, text: "x" });
});

test("AC-8: results are fresh objects on every call", async () => {
  const deps = { fetch: () => okJson("x"), env: {} };
  const first = await fetchRemoteConfig(patSettings(), deps);
  const second = await fetchRemoteConfig(patSettings(), deps);
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
});
