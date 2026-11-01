import assert from "node:assert/strict";
import * as realFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { __internals } from "../../plugin/azdo-remote-config.ts";

// Every test uses a temp dir as the injected home, a fake fetch / runAz and an injected env.
// No test touches the real home directory or the network.

const { runConfigHook } = __internals;

const PAT = "PATSENTINEL-9999";
const TOKEN = "tok.SENTINEL-4242";
const PLUGIN_PATH = fileURLToPath(new URL("../../plugin/azdo-remote-config.ts", import.meta.url));
const OPTIONS ={ org: "o", project: "p", repo: "r", pat: PAT };
const L_REMOTE = "Loaded shared config from Azure DevOps.";

interface LogArg {
  body: { service: string; level: string; message: string };
}

function makeHome(): string {
  return realFs.mkdtempSync(join(tmpdir(), "azdo-hook-"));
}

function cacheFile(home: string): string {
  return join(home, ".cache", "kilo-azdo", "remote-config.json");
}

function seedCache(home: string, value: unknown): string {
  const file = cacheFile(home);
  realFs.mkdirSync(join(home, ".cache", "kilo-azdo"), { recursive: true });
  realFs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value), "utf8");
  return file;
}

const BOUND = { org: "o", project: "p", repo: "r", path: "/kilo.jsonc", branch: "main" };
const FORMAT = "kilo-azdo-cache-v1";

function envelope(config: unknown, binding: unknown = BOUND, format: unknown = FORMAT) {
  return { format, binding, config };
}

// Writes the 0.8.0 cache envelope (ADR-0018); raw seedCache stays for corrupt and legacy files.
function seedBoundCache(home: string, config: unknown, binding: unknown = BOUND): string {
  return seedCache(home, envelope(config, binding));
}

// A class instance with a prototype method, like the generated Kilo SDK client.
function makeInput(behaviour: (arg: unknown) => unknown = () => undefined) {
  const logs: unknown[] = [];
  class App {
    log(this: App, arg: unknown): unknown {
      assert.ok(this instanceof App, "log must be called with app as this");
      logs.push(arg);
      return behaviour(arg);
    }
  }
  return { input: { client: { app: new App() } }, logs };
}

function messages(logs: unknown[]): string[] {
  return logs.map((l) => (l as LogArg).body.message);
}

function okFetch(text: string) {
  const calls: unknown[] = [];
  const fn = (url: string): Promise<Response> => {
    calls.push(url);
    return Promise.resolve(new Response(JSON.stringify({ content: text }), { status: 200 }));
  };
  return { fn, calls };
}

function failingFetch(marker: string) {
  return (): Promise<Response> => Promise.reject(new Error(`LEAK-${marker}`));
}

function noLeak(logs: unknown[]): void {
  assert.ok(!JSON.stringify(logs).includes("LEAK-"));
}

const SHARED = `{
  // shared defaults
  "model": "shared",
  "small_model": "s", /* block */
  "provider": { "bifrost": { "options": { "baseURL": "https://b/v1", "apiKey": "sk-bf-shared" } } },
}`;

function localConfig(): Record<string, unknown> {
  return { model: "local", provider: { bifrost: { options: { apiKey: "sk-bf-local" } } } };
}

async function run(opts: {
  home: string;
  fetch?: unknown;
  config?: unknown;
  options?: unknown;
  env?: Record<string, string>;
  extra?: Record<string, unknown>;
  behaviour?: (arg: unknown) => unknown;
}) {
  const { input, logs } = makeInput(opts.behaviour);
  const config = opts.config ?? localConfig();
  await runConfigHook(input, "options" in opts ? opts.options : OPTIONS, config, {
    env: opts.env ?? {},
    homedir: () => opts.home,
    fetch: opts.fetch,
    ...opts.extra,
  });
  return { logs, config };
}

test("AC1 defaults mode merges, keeps local values and the same reference", async () => {
  const home = makeHome();
  const cfg = localConfig();
  const provider = cfg.provider;
  const { logs } = await run({ home, config: cfg, fetch: okFetch(SHARED).fn });
  assert.equal(cfg.model, "local");
  assert.equal(cfg.small_model, "s");
  assert.equal(cfg.provider, provider);
  const options = (cfg.provider as any).bifrost.options;
  assert.equal(options.baseURL, "https://b/v1");
  assert.equal(options.apiKey, "sk-bf-local");
  assert.deepEqual(messages(logs), [L_REMOTE, "Applied shared config from remote in defaults mode."]);
});

test("AC1 enforce mode lets shared win but never replaces a local apiKey", async () => {
  const home = makeHome();
  const cfg = localConfig();
  const { logs } = await run({ home, config: cfg, fetch: okFetch(SHARED).fn, options: { ...OPTIONS, mode: "enforce" } });
  assert.equal(cfg.model, "shared");
  assert.equal((cfg.provider as any).bifrost.options.apiKey, "sk-bf-local");
  assert.equal((cfg.provider as any).bifrost.options.baseURL, "https://b/v1");
  assert.equal(messages(logs).at(-1), "Applied shared config from remote in enforce mode.");
});

test("AC2 success writes a sanitised unresolved cache atomically with an info log", async () => {
  const home = makeHome();
  const shared = '{"model":"m","note":"{env:X}","provider":{"b":{"apiKey":"sk-bf-shared","u":"https://x"}}}';
  const calls: Array<[string, unknown[]]> = [];
  const wrap = (name: keyof typeof realFs) => (...args: unknown[]) => {
    calls.push([name, args]);
    return (realFs[name] as (...a: unknown[]) => unknown)(...args);
  };
  const fs = {
    mkdirSync: wrap("mkdirSync"),
    writeFileSync: wrap("writeFileSync"),
    renameSync: wrap("renameSync"),
    unlinkSync: wrap("unlinkSync"),
    statSync: wrap("statSync"),
    readFileSync: wrap("readFileSync"),
  };
  const { logs } = await run({
    home,
    fetch: okFetch(shared).fn,
    env: { X: "resolved-secret-x" },
    extra: { fs },
  });
  const file = cacheFile(home);
  const text = realFs.readFileSync(file, "utf8");
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed, envelope({ model: "m", note: "{env:X}", provider: { b: { u: "https://x" } } }));
  assert.deepEqual(Object.keys(parsed), ["format", "binding", "config"]);
  assert.deepEqual(Object.keys(parsed.binding as object), ["org", "project", "repo", "path", "branch"]);
  assert.ok(!text.includes(PAT));
  assert.ok(!text.includes(Buffer.from(`:${PAT}`).toString("base64")));
  assert.ok(!text.includes("timeoutMs") && !text.includes('"mode"') && !text.includes('"pat"'));
  assert.ok(!text.includes("resolved-secret-x"));
  assert.ok(!text.includes("sk-bf-shared"));
  const write = calls.find(([n]) => n === "writeFileSync")!;
  const tmp = write[1][0] as string;
  assert.ok(tmp.endsWith(".tmp") && tmp.startsWith(file));
  assert.deepEqual(write[1][2], { encoding: "utf8", mode: 0o600, flag: "wx" });
  const rename = calls.find(([n]) => n === "renameSync")!;
  assert.deepEqual(rename[1], [tmp, file]);
  assert.ok(!calls.some(([n, a]) => n === "writeFileSync" && a[0] === file));
  assert.deepEqual(calls.find(([n]) => n === "mkdirSync")![1][1], { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") assert.equal(realFs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual((logs[0] as LogArg).body, { service: "azdo-remote-config", level: "info", message: L_REMOTE });
  assert.deepEqual(realFs.readdirSync(join(home, ".cache", "kilo-azdo")), ["remote-config.json"]);
});

const FETCH_FAILURES: Array<[string, () => { fetch: unknown; options?: unknown }]> = [
  ["network", () => ({ fetch: failingFetch("net") })],
  ["http-500", () => ({ fetch: () => Promise.resolve(new Response("x", { status: 500 })) })],
  ["timeout", () => ({ fetch: () => new Promise(() => {}), options: { ...OPTIONS, timeoutMs: 20 } })],
];

for (const [code, make] of FETCH_FAILURES) {
  test(`AC3 ${code} falls back to the cache without touching it`, async () => {
    const home = makeHome();
    const file = seedBoundCache(home, { model: "cached", extra: "{env:SECRET_VAR}" });
    const before = realFs.readFileSync(file);
    const mtime = realFs.statSync(file).mtimeMs;
    const { fetch, options } = make();
    const cfg = { other: 1 };
    const { logs } = await run({ home, config: cfg, fetch, options: options ?? OPTIONS, env: { SECRET_VAR: "v" } });
    assert.deepEqual(cfg, { other: 1, model: "cached", extra: "v" });
    assert.deepEqual(realFs.readFileSync(file), before);
    assert.equal(realFs.statSync(file).mtimeMs, mtime);
    assert.deepEqual(messages(logs), [
      `Remote config unavailable (${code}); using cached config.`,
      "Applied shared config from cache in defaults mode.",
    ]);
    assert.equal((logs[0] as LogArg).body.level, "warn");
    noLeak(logs);
  });
}

const BAD_CACHES: unknown[] = ["not json at all", "{", "[]", '"str"', "1", "null", ""];

for (const bad of BAD_CACHES) {
  test(`AC4 corrupt cache ${JSON.stringify(bad)} is never merged`, async () => {
    const home = makeHome();
    seedCache(home, bad as string);
    const cfg = localConfig();
    const { logs } = await run({ home, config: cfg, fetch: failingFetch("x") });
    assert.deepEqual(cfg, localConfig());
    assert.deepEqual(messages(logs), [
      "Remote config unavailable (network) and no usable cache (cache-invalid); continuing with local config only.",
    ]);
    assert.equal((logs[0] as LogArg).body.level, "error");
  });
}

test("AC4 absent cache leaves the config unchanged with an error log", async () => {
  const home = makeHome();
  const cfg = localConfig();
  const { logs } = await run({ home, config: cfg, fetch: failingFetch("x") });
  assert.deepEqual(cfg, localConfig());
  assert.match(messages(logs)[0]!, /no usable cache \(cache-missing\)/);
  assert.equal(realFs.existsSync(join(home, ".cache")), false);
});

test("AC4 oversized cache is unreadable", async () => {
  const home = makeHome();
  const fs = {
    statSync: () => ({ isFile: () => true, size: 2 * 1024 * 1024 + 1 }),
    readFileSync: () => assert.fail("must not read"),
  };
  const { logs } = await run({ home, fetch: failingFetch("x"), extra: { fs } });
  assert.match(messages(logs)[0]!, /\(cache-unreadable\)/);
});

const L_NONE_SKIPPED =
  "Remote config unavailable (missing-settings) and no usable cache (cache-skipped); continuing with local config only.";

const MISSING_CASES: Array<[string, string[], Record<string, string>]> = [
  ["org", ["org"], { project: "p", repo: "r" }],
  ["project", ["project"], { org: "o", repo: "r" }],
  ["repo", ["repo"], { org: "o", project: "p" }],
  ["org, project, repo", ["org", "project", "repo"], {}],
];

for (const [label, names, options] of MISSING_CASES) {
  test(`T013 AC5 missing ${label} skips fetch, az and the cache entirely`, async () => {
    const home = makeHome();
    const file = seedBoundCache(home, { model: "cached" });
    const before = realFs.readFileSync(file);
    const fetchSpy = okFetch("{}");
    const azCalls: unknown[] = [];
    const fsCalls: string[] = [];
    const spyFs: Record<string, unknown> = {};
    for (const name of ["mkdirSync", "writeFileSync", "renameSync", "unlinkSync", "statSync", "readFileSync"] as const) {
      spyFs[name] = (...args: unknown[]) => {
        fsCalls.push(name);
        return (realFs[name] as (...a: unknown[]) => unknown)(...args);
      };
    }
    const cfg: Record<string, unknown> = {};
    const { logs } = await run({
      home,
      config: cfg,
      fetch: fetchSpy.fn,
      options,
      extra: { runAz: () => azCalls.push(1), fs: spyFs },
    });
    assert.equal(fetchSpy.calls.length, 0);
    assert.equal(azCalls.length, 0);
    assert.deepEqual(fsCalls, []);
    assert.deepEqual(cfg, {});
    assert.deepEqual(messages(logs), [
      `Remote config skipped: missing required settings: ${names.join(", ")}.`,
      L_NONE_SKIPPED,
    ]);
    assert.equal((logs[1] as LogArg).body.level, "error");
    assert.deepEqual(realFs.readFileSync(file), before);
  });
}

test("AC5 an invalid option logs its warning text", async () => {
  const home = makeHome();
  const { logs } = await run({ home, fetch: okFetch("{}").fn, options: { ...OPTIONS, mode: "ENFORCE" } });
  assert.equal((logs[0] as LogArg).body.level, "warn");
  assert.match(messages(logs)[0]!, /mode/);
});

const deepText = '{"a":'.repeat(70) + "1" + "}".repeat(70);
const INVALID_FETCHED: Array<[string, string]> = [
  ["{ broken", "invalid-jsonc"],
  ["[]", "invalid-shape"],
  ['"s"', "invalid-shape"],
  ["1", "invalid-shape"],
  ["null", "invalid-shape"],
  [deepText, "invalid-shape"],
];

for (const [text, reason] of INVALID_FETCHED) {
  test(`AC5 invalid fetched content ${text.slice(0, 12)} is never cached or merged`, async () => {
    const home = makeHome();
    const cfg = localConfig();
    const { logs } = await run({ home, config: cfg, fetch: okFetch(text).fn });
    assert.deepEqual(cfg, localConfig());
    assert.equal(realFs.existsSync(join(home, ".cache")), false);
    assert.match(messages(logs)[0]!, new RegExp(`\\(${reason}\\)`));
  });
}

test("AC5 invalid fetched content keeps an existing cache and uses it", async () => {
  const home = makeHome();
  const file = seedBoundCache(home, { model: "cached" });
  const before = realFs.readFileSync(file);
  const cfg: Record<string, unknown> = {};
  const { logs } = await run({ home, config: cfg, fetch: okFetch("[]").fn });
  assert.deepEqual(realFs.readFileSync(file), before);
  assert.equal(cfg.model, "cached");
  assert.match(messages(logs)[0]!, /\(invalid-shape\); using cached config/);
});

test("AC6 unresolved placeholders log names only; resolved values are applied but never logged", async () => {
  const home = makeHome();
  const cfg: Record<string, unknown> = {};
  const { logs } = await run({
    home,
    config: cfg,
    fetch: okFetch('{"x":"{env:MISSING}","y":"{env:SECRET_VAR}"}').fn,
    env: { SECRET_VAR: "s3cr3t-value" },
  });
  assert.equal("x" in cfg, false);
  assert.equal(cfg.y, "s3cr3t-value");
  assert.ok(messages(logs).includes("Unresolved placeholders: env:MISSING."));
  assert.ok(!JSON.stringify(logs).includes("s3cr3t-value"));
});

test("AC6 placeholder names are sanitised and capped at 20", async () => {
  const home = makeHome();
  const parts = ['"c":"{env:A\\u0001B\\u007fC\\u0085D}"'];
  for (let i = 0; i < 24; i++) parts.push(`"k${i}":"{env:V${i}}"`);
  const { logs } = await run({ home, fetch: okFetch(`{${parts.join(",")}}`).fn });
  const line = messages(logs).find((m) => m.startsWith("Unresolved placeholders: "))!;
  assert.ok(line.startsWith("Unresolved placeholders: env:A?B?C?D, env:V0,"));
  assert.ok(line.endsWith(", and 5 more."));
  assert.equal(line.split(", env:").length - 1, 19);
  const long = "N".repeat(500);
  const second = await run({ home: makeHome(), fetch: okFetch(`{"a":"{env:${long}}"}`).fn });
  assert.ok(messages(second.logs).some((m) => m === `Unresolved placeholders: ${`env:${long}`.slice(0, 200)}.`));
});

function assertSecretFree(logs: unknown[], secrets: string[]): void {
  for (const arg of logs) {
    const shape = arg as LogArg;
    assert.deepEqual(Object.keys(shape), ["body"]);
    assert.deepEqual(Object.keys(shape.body), ["service", "level", "message"]);
    for (const v of Object.values(shape.body)) assert.equal(typeof v, "string");
    const dumps = [JSON.stringify(arg), inspect(arg, { showHidden: true, depth: null })];
    for (const dump of dumps) for (const secret of secrets) assert.ok(!dump.includes(secret), secret);
  }
}

test("AC7 no log argument contains a secret on success, fallback, az and exception paths", async () => {
  const secrets = [PAT, TOKEN, "sk-bf-local", "sk-bf-shared", "s3cr3t-value"];
  const shared = '{"k":"{env:SECRET_VAR}","provider":{"b":{"apiKey":"sk-bf-shared"}}}';
  const env = { SECRET_VAR: "s3cr3t-value" };
  const all: unknown[] = [];

  const success = await run({ home: makeHome(), fetch: okFetch(shared).fn, env });
  all.push(...success.logs);

  const home = makeHome();
  seedBoundCache(home, JSON.parse(shared));
  const fallback = await run({ home, fetch: failingFetch("s3cr3t-value"), env });
  assert.equal(messages(fallback.logs).at(-1), "Applied shared config from cache in defaults mode.");
  all.push(...fallback.logs);

  const mismatchHome = makeHome();
  seedBoundCache(mismatchHome, JSON.parse(shared), { ...BOUND, branch: "other" });
  const mismatch = await run({ home: mismatchHome, fetch: failingFetch("s3cr3t-value"), env });
  assert.match(messages(mismatch.logs)[0]!, /\(cache-mismatch\)/);
  all.push(...mismatch.logs);

  const azRun = await run({
    home: makeHome(),
    fetch: okFetch(shared).fn,
    env,
    options: { org: "o", project: "p", repo: "r" },
    extra: { runAz: () => Promise.resolve({ exitCode: 0, stdout: `${TOKEN}\n` }) },
  });
  all.push(...azRun.logs);

  const thrown = await run({
    home: makeHome(),
    fetch: () => {
      throw new Error(`${PAT} ${TOKEN}`);
    },
    env,
    behaviour: () => {
      throw new Error(PAT);
    },
  });
  all.push(...thrown.logs);

  assert.ok(all.length >= 6);
  assertSecretFree(all, secrets);
});

test("AC8 never rejects and never leaks error text for failing collaborators", async () => {
  const cases: Array<{ name: string; extra?: Record<string, unknown>; fetch?: unknown; text?: string }> = [
    { name: "fetch rejects", fetch: failingFetch("a") },
    { name: "parseJsonc fails", text: "{" },
    {
      name: "mkdir throws",
      text: "{}",
      extra: {
        fs: {
          mkdirSync: () => {
            throw new Error("LEAK-mkdir");
          },
        },
      },
    },
    {
      name: "writeFile throws",
      text: "{}",
      extra: {
        fs: {
          mkdirSync: () => undefined,
          writeFileSync: () => {
            throw new Error("LEAK-write");
          },
        },
      },
    },
    { name: "fs wrong type", text: "{}", extra: { fs: "nope" } },
    { name: "homedir wrong type", text: "{}", extra: { homedir: 5 } },
    { name: "homedir relative", text: "{}", extra: { homedir: () => "rel/path" } },
    {
      name: "homedir throws",
      text: "{}",
      extra: {
        homedir: () => {
          throw new Error("LEAK-home");
        },
      },
    },
  ];
  for (const c of cases) {
    const home = makeHome();
    const cfg = localConfig();
    const fetch = c.fetch ?? okFetch(c.text ?? "{}").fn;
    const { logs } = await run({ home, config: cfg, fetch, extra: c.extra });
    noLeak(logs);
    assert.deepEqual(cfg, localConfig(), `${c.name}: cfg must be unchanged (remote is empty or unusable)`);
    assert.equal(realFs.existsSync(join(home, ".cache")), false, c.name);
    for (const m of messages(logs)) assert.equal(typeof m, "string");
  }
});

test("AC8 rename failure removes the temp file and the merge still happens", async () => {
  const home = makeHome();
  const unlinked: string[] = [];
  const fs = {
    mkdirSync: realFs.mkdirSync,
    writeFileSync: realFs.writeFileSync,
    renameSync: () => {
      throw new Error("LEAK-rename");
    },
    unlinkSync: (p: string) => {
      unlinked.push(p);
      realFs.unlinkSync(p);
    },
  };
  const cfg: Record<string, unknown> = {};
  const { logs } = await run({ home, config: cfg, fetch: okFetch('{"a":1}').fn, extra: { fs } });
  assert.equal(unlinked.length, 1);
  assert.deepEqual(realFs.readdirSync(join(home, ".cache", "kilo-azdo")), []);
  assert.deepEqual(messages(logs), [
    L_REMOTE,
    "Could not update the config cache (cache-write-failed).",
    "Applied shared config from remote in defaults mode.",
  ]);
  assert.equal(cfg.a, 1);
  noLeak(logs);
});

test("AC8 oversized shared config is not cached", async () => {
  const home = makeHome();
  const fs = { mkdirSync: () => assert.fail("must not mkdir") };
  const text = `{"a":[${new Array(500000).fill("1").join(",")}]}`;
  assert.ok(text.length < 1024 * 1024);
  const cfg: Record<string, unknown> = {};
  const { logs } = await run({ home, config: cfg, fetch: okFetch(text).fn, extra: { fs } });
  assert.deepEqual(messages(logs).slice(0, 2), [L_REMOTE, "Could not update the config cache (cache-too-large)."]);
  assert.equal((cfg.a as unknown[]).length, 500000);
});

test("AC8 logger that throws, rejects or never settles does not stop the hook", async () => {
  const behaviours: Array<(arg: unknown) => unknown> = [
    () => {
      throw new Error("LEAK-log");
    },
    () => Promise.reject(new Error("LEAK-log")),
    () => new Promise(() => {}),
    () => ({
      then() {
        throw new Error("LEAK-then");
      },
    }),
  ];
  for (const behaviour of behaviours) {
    const cfg: Record<string, unknown> = {};
    await run({ home: makeHome(), config: cfg, fetch: okFetch('{"a":1}').fn, behaviour });
    assert.equal(cfg.a, 1);
  }
});

test("AC8 missing or odd logger is silent", async () => {
  for (const input of [undefined, null, 5, {}, { client: null }, { client: { app: { log: "x" } } }]) {
    const cfg: Record<string, unknown> = {};
    await runConfigHook(input, OPTIONS, cfg, { env: {}, homedir: () => makeHome(), fetch: okFetch('{"a":1}').fn });
    assert.equal(cfg.a, 1);
  }
});

test("AC8 frozen config is unchanged and logs L-MERGE", async () => {
  const cfg = Object.freeze({ model: "local" });
  const { logs } = await run({ home: makeHome(), config: cfg, fetch: okFetch('{"new":1}').fn });
  assert.deepEqual(cfg, { model: "local" });
  assert.equal(messages(logs).at(-1), "Could not apply the shared config; local config left unchanged.");
});

test("AC8 a frozen nested object rolls back earlier top-level writes", async () => {
  const cfg = { provider: Object.freeze({}) } as Record<string, unknown>;
  const { logs } = await run({
    home: makeHome(),
    config: cfg,
    fetch: okFetch('{"model":"m","provider":{"x":1}}').fn,
  });
  assert.deepEqual(Object.keys(cfg), ["provider"]);
  assert.deepEqual(cfg.provider, {});
  assert.equal(messages(logs).at(-1), "Could not apply the shared config; local config left unchanged.");
});

test("AC8 rollback restores overwritten values in enforce mode", async () => {
  const nested = Object.freeze({ keep: 1 });
  const cfg = { model: "local", provider: nested } as Record<string, unknown>;
  await run({
    home: makeHome(),
    config: cfg,
    fetch: okFetch('{"model":"shared","provider":{"added":1}}').fn,
    options: { ...OPTIONS, mode: "enforce" },
  });
  assert.equal(cfg.model, "local");
  assert.deepEqual(cfg.provider, { keep: 1 });
});

test("AC8 hostile options never reject", async () => {
  for (const options of [null, "x", [], 5, undefined]) {
    const cfg = localConfig();
    const { logs } = await run({ home: makeHome(), config: cfg, options, fetch: okFetch("{}").fn });
    assert.deepEqual(cfg, localConfig());
    assert.ok(logs.length >= 1);
  }
});

test("AC8 a config that is not an object logs L-BADCONFIG and fetches nothing", async () => {
  for (const config of [null, "x", 5, []]) {
    const fetchSpy = okFetch("{}");
    const { input, logs } = makeInput();
    await runConfigHook(input, OPTIONS, config, { env: {}, homedir: () => makeHome(), fetch: fetchSpy.fn });
    assert.deepEqual(messages(logs), ["Shared config not applied: the Kilo config is not an object."]);
    assert.equal(fetchSpy.calls.length, 0);
  }
});

test("AC8 hostile deps never reject (default deps run in a child process with a temp home)", () => {
  const home = realFs.mkdtempSync(join(tmpdir(), "azdo-hostile-home-"));
  try {
    const env: Record<string, string | undefined> = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("KILO_AZDO_") || key === "AZDO_PAT" || key === "AZURE_DEVOPS_EXT_PAT") delete env[key];
    }
    env.HOME = home;
    env.USERPROFILE = home;
    const script = [
      `const { __internals } = await import(${JSON.stringify(pathToFileURL(PLUGIN_PATH).href)});`,
      "const results = [];",
      "for (const deps of [null, 'x', 5, [], undefined]) {",
      "  const cfg = {};",
      "  await __internals.runConfigHook({}, { org: 'o' }, cfg, deps);",
      "  results.push(cfg);",
      "}",
      "console.log(JSON.stringify(results));",
    ].join("\n");
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { env, encoding: "utf8" });
    assert.deepEqual(JSON.parse(out), [{}, {}, {}, {}, {}]);
    assert.equal(realFs.existsSync(join(home, ".cache")), false);
  } finally {
    realFs.rmSync(home, { recursive: true, force: true });
  }
});

test("AC8 server hook resolves for a non-object config without any I/O", async () => {
  const { default: plugin } = await import("../../plugin/azdo-remote-config.ts");
  const hooks = await plugin.server({}, { org: "o" });
  await hooks.config(null as never);
});

// ---- T-013: the cache is bound to the settings that produced it (ADR-0018) ----

const A = { org: "orgSentA", project: "projSentA", repo: "repoSentA", path: "/sentA.jsonc", branch: "brSentA" };
const B = { org: "orgSentB", project: "projSentB", repo: "repoSentB", path: "/sentB.jsonc", branch: "brSentB" };
const A_VALUES = Object.values(A);
const B_VALUES = Object.values(B);
const L_NETWORK_MISMATCH =
  "Remote config unavailable (network) and no usable cache (cache-mismatch); continuing with local config only.";
const L_CACHE_NETWORK = "Remote config unavailable (network); using cached config.";

function noneLine(code: string, reason = "network"): string {
  return `Remote config unavailable (${reason}) and no usable cache (${code}); continuing with local config only.`;
}

async function writeRealCache(home: string, options: Record<string, unknown>, shared = '{"model":"cached"}') {
  await run({ home, options, fetch: okFetch(shared).fn });
  return cacheFile(home);
}

test("T013 AC1 a cache written for other settings is not applied, one field at a time", async () => {
  for (const field of Object.keys(A) as Array<keyof typeof A>) {
    const home = makeHome();
    const file = await writeRealCache(home, { ...A, pat: PAT });
    const before = realFs.readFileSync(file);
    const mtime = realFs.statSync(file).mtimeMs;
    const cfg = localConfig();
    const options = { ...A, [field]: B[field], pat: PAT };
    const { logs } = await run({ home, config: cfg, options, fetch: failingFetch("n") });
    assert.deepEqual(cfg, localConfig(), field);
    assert.deepEqual(messages(logs), [L_NETWORK_MISMATCH], field);
    assert.equal((logs[0] as LogArg).body.level, "error");
    const dump = JSON.stringify(logs);
    for (const value of [...A_VALUES, ...B_VALUES]) assert.ok(!dump.includes(value), `${field}: ${value}`);
    assert.deepEqual(realFs.readFileSync(file), before);
    assert.equal(realFs.statSync(file).mtimeMs, mtime);
  }
});

test("T013 AC2 a cache written for the same settings is applied; mode is not bound", async () => {
  for (const mode of ["defaults", "enforce"]) {
    const home = makeHome();
    await writeRealCache(home, { ...A, pat: PAT, mode: "defaults" }, '{"model":"cached","x":1}');
    const cfg = { model: "local" } as Record<string, unknown>;
    const { logs } = await run({ home, config: cfg, options: { ...A, pat: PAT, mode }, fetch: failingFetch("n") });
    assert.deepEqual(messages(logs), [L_CACHE_NETWORK, `Applied shared config from cache in ${mode} mode.`]);
    assert.equal(cfg.x, 1);
    assert.equal(cfg.model, mode === "enforce" ? "cached" : "local");
  }
});

interface CredentialCase {
  options: Record<string, unknown>;
  env: Record<string, string>;
  extra: Record<string, unknown>;
}

const AZ_TOKEN = { runAz: () => Promise.resolve({ exitCode: 0, stdout: `${TOKEN}\n` }) };
const CREDENTIAL_SOURCES: Array<[string, CredentialCase]> = [
  ["pat option", { options: { ...A, pat: PAT }, env: {}, extra: {} }],
  ["AZDO_PAT", { options: { ...A }, env: { AZDO_PAT: PAT }, extra: {} }],
  ["KILO_AZDO_PAT", { options: { ...A }, env: { KILO_AZDO_PAT: PAT }, extra: {} }],
  ["AZURE_DEVOPS_EXT_PAT", { options: { ...A }, env: { AZURE_DEVOPS_EXT_PAT: PAT }, extra: {} }],
  ["az token", { options: { ...A }, env: {}, extra: AZ_TOKEN }],
];

for (const [source, c] of CREDENTIAL_SOURCES) {
  test(`T013 AC3 the cache bytes hold no credential (${source})`, async () => {
    const home = makeHome();
    await run({ home, options: c.options, env: c.env, extra: c.extra, fetch: okFetch('{"model":"m"}').fn });
    const text = realFs.readFileSync(cacheFile(home), "utf8");
    const basic = Buffer.from(`:${PAT}`).toString("base64");
    for (const secret of [PAT, TOKEN, basic, "Bearer", "Basic ", '"pat"', '"mode"', "timeoutMs"]) {
      assert.ok(!text.includes(secret), `${source}: ${secret}`);
    }
    const parsed = JSON.parse(text);
    assert.deepEqual(Object.keys(parsed.binding), ["org", "project", "repo", "path", "branch"]);
    assert.deepEqual(parsed.binding, A);
  });
}

const OUTDATED: Array<[string, unknown]> = [
  ["legacy bare config", { model: "cached" }],
  ["empty object", {}],
  ["format v0", envelope({ model: "cached" }, BOUND, "kilo-azdo-cache-v0")],
  ["format number", envelope({ model: "cached" }, BOUND, 1)],
  ["format null", envelope({ model: "cached" }, BOUND, null)],
];

for (const [label, value] of OUTDATED) {
  test(`T013 AC4 ${label} is cache-outdated and not applied`, async () => {
    const home = makeHome();
    const file = seedCache(home, value);
    const before = realFs.readFileSync(file);
    const cfg = localConfig();
    const { logs } = await run({ home, config: cfg, fetch: failingFetch("n") });
    assert.deepEqual(cfg, localConfig());
    assert.deepEqual(messages(logs), [noneLine("cache-outdated")]);
    assert.deepEqual(realFs.readFileSync(file), before);
  });
}

const { org: _org, ...NO_ORG } = BOUND;
const MALFORMED: Array<[string, unknown]> = [
  ["binding missing a field", envelope({ a: 1 }, NO_ORG)],
  ["binding with an extra field", envelope({ a: 1 }, { ...BOUND, extra: "x" })],
  ["binding number value", envelope({ a: 1 }, { ...BOUND, org: 5 })],
  ["binding null value", envelope({ a: 1 }, { ...BOUND, repo: null })],
  ["binding array", envelope({ a: 1 }, [])],
  ["binding null", envelope({ a: 1 }, null)],
  ["binding missing", { format: FORMAT, config: { a: 1 } }],
  ["config array", envelope([])],
  ["config missing", { format: FORMAT, binding: BOUND }],
  ["config string", envelope("x")],
  ["extra top-level key", { ...envelope({ a: 1 }), extra: 1 }],
  ["malformed binding with different values", envelope({ a: 1 }, { ...B, extra: "x" })],
  ["config with a container at level 64", envelope(JSON.parse('{"a":'.repeat(65) + "1" + "}".repeat(65)))],
];

for (const [label, value] of MALFORMED) {
  test(`T013 AC4 ${label} is cache-invalid and not applied`, async () => {
    const home = makeHome();
    const file = seedCache(home, value);
    const before = realFs.readFileSync(file);
    const cfg = localConfig();
    const { logs } = await run({ home, config: cfg, fetch: failingFetch("n") });
    assert.deepEqual(cfg, localConfig());
    assert.deepEqual(messages(logs), [noneLine("cache-invalid")]);
    assert.deepEqual(realFs.readFileSync(file), before);
  });
}

test("T013 AC4 config with containers down to level 63 is still applied", async () => {
  const home = makeHome();
  seedBoundCache(home, JSON.parse('{"a":'.repeat(64) + "1" + "}".repeat(64)));
  const cfg: Record<string, unknown> = {};
  const { logs } = await run({ home, config: cfg, fetch: failingFetch("n") });
  assert.equal(messages(logs).at(-1), "Applied shared config from cache in defaults mode.");
  assert.ok("a" in cfg);
});

test("T013 AC4 a successful fetch rewrites a legacy cache in the bound format", async () => {
  const home = makeHome();
  seedCache(home, { model: "cached" });
  await run({ home, fetch: okFetch('{"model":"fresh"}').fn });
  assert.deepEqual(JSON.parse(realFs.readFileSync(cacheFile(home), "utf8")), envelope({ model: "fresh" }));
});

test("T013 AC6 comparison uses normalised settings, case-sensitively, without trimming stored values", async () => {
  const applied = async (stored: unknown, options: Record<string, unknown>, env: Record<string, string> = {}) => {
    const home = makeHome();
    seedBoundCache(home, { model: "cached" }, stored);
    const { logs } = await run({ home, options, env, fetch: failingFetch("n") });
    return messages(logs);
  };
  const ok = [L_CACHE_NETWORK, "Applied shared config from cache in defaults mode."];
  assert.deepEqual(await applied(BOUND, { ...OPTIONS, org: " o " }), ok);
  assert.deepEqual(await applied(BOUND, { ...OPTIONS, org: "O" }), [L_NETWORK_MISMATCH]);
  assert.deepEqual(await applied(BOUND, { ...OPTIONS, path: "kilo.jsonc" }), ok);
  assert.deepEqual(await applied(BOUND, { ...OPTIONS, branch: undefined }), ok);
  assert.deepEqual(await applied({ ...BOUND, org: " o" }, OPTIONS), [L_NETWORK_MISMATCH]);
  const fromEnv = { KILO_AZDO_ORG: "o", KILO_AZDO_PROJECT: "p", KILO_AZDO_REPO: "r" };
  assert.deepEqual(await applied(BOUND, { pat: PAT }, fromEnv), ok);
});
