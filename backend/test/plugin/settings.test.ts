import assert from "node:assert/strict";
import { test } from "node:test";
import { __internals } from "../../plugin/azdo-remote-config.ts";

const { resolveSettings } = __internals;

type Env = Record<string, string | undefined>;

const SENTINEL = "PAT-SENTINEL-1234";
const W0 = "Ignored plugin options: expected an object.";
const NOT_STRING = "expected a string.";
const NOT_ALLOWED = "contains characters or segments that are not allowed.";
const MODE_HINT = 'expected "defaults" or "enforce".';
const TIMEOUT_HINT = "expected a whole number of milliseconds from 1 to 2147483647.";

const ENV_NAMES: Record<string, string> = {
  org: "KILO_AZDO_ORG",
  project: "KILO_AZDO_PROJECT",
  repo: "KILO_AZDO_REPO",
  path: "KILO_AZDO_PATH",
  branch: "KILO_AZDO_BRANCH",
  mode: "KILO_AZDO_MODE",
  pat: "KILO_AZDO_PAT",
  timeoutMs: "KILO_AZDO_TIMEOUT_MS",
};

function optWarn(name: string, hint: string): string {
  return `Ignored plugin option ${name}: ${hint}`;
}

function envWarn(name: string, hint: string): string {
  return `Ignored environment variable ${ENV_NAMES[name]} (${name}): ${hint}`;
}

function run(options?: unknown, env: Env = {}) {
  return resolveSettings(options, { env });
}

function pat(result: ReturnType<typeof resolveSettings>): string | undefined {
  return result.settings.pat;
}

// AC-1
test("precedence: option beats env for all 8 settings", () => {
  const options = {
    org: "oo",
    project: "op",
    repo: "or",
    path: "/o/p.jsonc",
    branch: "obranch",
    mode: "enforce",
    pat: "opt-pat",
    timeoutMs: 3000,
  };
  const env: Env = {
    KILO_AZDO_ORG: "eo",
    KILO_AZDO_PROJECT: "ep",
    KILO_AZDO_REPO: "er",
    KILO_AZDO_PATH: "/e/p.jsonc",
    KILO_AZDO_BRANCH: "ebranch",
    KILO_AZDO_MODE: "defaults",
    KILO_AZDO_PAT: "env-pat",
    KILO_AZDO_TIMEOUT_MS: "2500",
  };
  const r = run(options, env);
  assert.deepEqual(r.settings, {
    org: "oo",
    project: "op",
    repo: "or",
    path: "/o/p.jsonc",
    branch: "obranch",
    mode: "enforce",
    timeoutMs: 3000,
  });
  assert.equal(pat(r), "opt-pat");
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.warnings, []);
});

test("precedence: env beats default for all 8 settings", () => {
  const env: Env = {
    KILO_AZDO_ORG: "eo",
    KILO_AZDO_PROJECT: "ep",
    KILO_AZDO_REPO: "er",
    KILO_AZDO_PATH: "e/p.jsonc",
    KILO_AZDO_BRANCH: "dev",
    KILO_AZDO_MODE: "enforce",
    KILO_AZDO_PAT: "env-pat",
    KILO_AZDO_TIMEOUT_MS: "2500",
  };
  const r = run(undefined, env);
  assert.deepEqual(r.settings, {
    org: "eo",
    project: "ep",
    repo: "er",
    path: "/e/p.jsonc",
    branch: "dev",
    mode: "enforce",
    timeoutMs: 2500,
  });
  assert.equal(pat(r), "env-pat");
});

test("precedence: pat option beats KILO_AZDO_PAT", () => {
  assert.equal(pat(run({ pat: "from-option" }, { KILO_AZDO_PAT: "from-env" })), "from-option");
});

test("precedence: option-only values with empty env", () => {
  const r = run({ org: "a", timeoutMs: 3000 }, {});
  assert.equal(r.settings.org, "a");
  assert.equal(r.settings.timeoutMs, 3000);
  assert.deepEqual(r.missing, ["project", "repo"]);
});

// AC-2
test("defaults with nothing configured", () => {
  const r = resolveSettings(undefined, { env: {} });
  assert.deepEqual(r.settings, {
    org: undefined,
    project: undefined,
    repo: undefined,
    path: "/kilo.jsonc",
    branch: "main",
    mode: "defaults",
    timeoutMs: 5000,
  });
  assert.equal(r.settings.pat, undefined);
  assert.equal("pat" in r.settings, true);
  assert.deepEqual(r.missing, ["org", "project", "repo"]);
  assert.deepEqual(r.warnings, []);
});

test("missing is empty when all three are set and lists only repo when repo is unset", () => {
  assert.deepEqual(run({ org: "o", project: "p", repo: "r" }).missing, []);
  assert.deepEqual(run({ org: "o", project: "p" }).missing, ["repo"]);
  assert.deepEqual(run({}, { KILO_AZDO_ORG: "o", KILO_AZDO_REPO: "r" }).missing, ["project"]);
});

test("settings key order is fixed and pat is not enumerable", () => {
  const r = run({ pat: SENTINEL });
  assert.deepEqual(Object.keys(r.settings), ["org", "project", "repo", "path", "branch", "mode", "timeoutMs"]);
  assert.equal(Object.getPrototypeOf(r.settings), Object.prototype);
});

// AC-3
test("mode enforce from option and env, with trimming", () => {
  assert.equal(run({ mode: "enforce" }).settings.mode, "enforce");
  assert.equal(run(undefined, { KILO_AZDO_MODE: "enforce" }).settings.mode, "enforce");
  assert.equal(run({ mode: "  enforce  " }).settings.mode, "enforce");
  assert.equal(run({ mode: "defaults" }, { KILO_AZDO_MODE: "enforce" }).settings.mode, "defaults");
});

test("invalid mode falls back to defaults with exact warnings", () => {
  for (const bad of ["force", "ENFORCE", "Enforce", 1, true, {}]) {
    const fromOption = run({ mode: bad });
    assert.equal(fromOption.settings.mode, "defaults");
    assert.deepEqual(fromOption.warnings, [optWarn("mode", MODE_HINT)]);
  }
  for (const bad of ["force", "ENFORCE", "Enforce", "1"]) {
    const fromEnv = run(undefined, { KILO_AZDO_MODE: bad });
    assert.equal(fromEnv.settings.mode, "defaults");
    assert.deepEqual(fromEnv.warnings, [envWarn("mode", MODE_HINT)]);
  }
});

test("empty mode is silent", () => {
  for (const empty of ["", "   "]) {
    const r = run({ mode: empty }, { KILO_AZDO_MODE: empty });
    assert.equal(r.settings.mode, "defaults");
    assert.deepEqual(r.warnings, []);
  }
});

test("invalid mode option falls through to valid env enforce", () => {
  const r = run({ mode: "force" }, { KILO_AZDO_MODE: "enforce" });
  assert.equal(r.settings.mode, "enforce");
  assert.deepEqual(r.warnings, [optWarn("mode", MODE_HINT)]);
});

// AC-4
test("invalid timeoutMs options give 5000 and the exact warning", () => {
  const bad: unknown[] = [0, -1, Number.NaN, Infinity, -Infinity, 2.5, "abc", true, {}, 2147483648];
  for (const value of bad) {
    const r = run({ timeoutMs: value });
    assert.equal(r.settings.timeoutMs, 5000, String(value));
    assert.deepEqual(r.warnings, [optWarn("timeoutMs", TIMEOUT_HINT)], String(value));
  }
});

test("invalid timeoutMs env values give 5000 and the exact warning", () => {
  const bad = ["0", "-5", "abc", "NaN", "Infinity", "2.5", "1e3", "0x10", "2147483648", "+5", "1_000"];
  for (const value of bad) {
    const r = run(undefined, { KILO_AZDO_TIMEOUT_MS: value });
    assert.equal(r.settings.timeoutMs, 5000, value);
    assert.deepEqual(r.warnings, [envWarn("timeoutMs", TIMEOUT_HINT)], value);
  }
});

test("valid timeoutMs forms are accepted", () => {
  assert.equal(run(undefined, { KILO_AZDO_TIMEOUT_MS: " 2500 " }).settings.timeoutMs, 2500);
  assert.equal(run({ timeoutMs: 2147483647 }).settings.timeoutMs, 2147483647);
  assert.equal(run({ timeoutMs: "3000" }).settings.timeoutMs, 3000);
  assert.equal(run({ timeoutMs: 1 }).settings.timeoutMs, 1);
});

test("empty timeoutMs is silent and invalid option falls through to valid env", () => {
  assert.deepEqual(run({ timeoutMs: "  " }, { KILO_AZDO_TIMEOUT_MS: "" }).warnings, []);
  const r = run({ timeoutMs: 0 }, { KILO_AZDO_TIMEOUT_MS: "1200" });
  assert.equal(r.settings.timeoutMs, 1200);
  assert.deepEqual(r.warnings, [optWarn("timeoutMs", TIMEOUT_HINT)]);
});

// AC-5
test("null options give no warning; non-object options give exactly W0", () => {
  assert.deepEqual(run(null).warnings, []);
  assert.deepEqual(run(undefined).warnings, []);
  const nonObjects: unknown[] = [[], ["org"], "str", 42, true, () => 1];
  for (const options of nonObjects) {
    const r = run(options, { KILO_AZDO_ORG: "envorg", KILO_AZDO_BRANCH: "dev" });
    assert.deepEqual(r.warnings, [W0]);
    assert.equal(r.settings.org, "envorg");
    assert.equal(r.settings.branch, "dev");
    assert.equal(r.settings.path, "/kilo.jsonc");
  }
});

test("wrongly typed strings give W1 and env applies", () => {
  const r = run({ org: 5, branch: {} }, { KILO_AZDO_ORG: "envorg", KILO_AZDO_BRANCH: "dev" });
  assert.equal(r.settings.org, "envorg");
  assert.equal(r.settings.branch, "dev");
  assert.deepEqual(r.warnings, [optWarn("org", NOT_STRING), optWarn("branch", NOT_STRING)]);
});

test("empty and whitespace-only strings are silent; values are trimmed", () => {
  for (const empty of ["", "   "]) {
    const r = run({ org: empty }, { KILO_AZDO_ORG: "envorg" });
    assert.equal(r.settings.org, "envorg");
    assert.deepEqual(r.warnings, []);
  }
  assert.equal(run({ org: "  a  " }).settings.org, "a");
  assert.equal(run({ pat: "  tok  " }).settings.pat, "tok");
});

test("path normalisation and rejection", () => {
  assert.equal(run({ path: "teams/a/kilo.jsonc" }).settings.path, "/teams/a/kilo.jsonc");
  assert.equal(run({ path: " /x/y.json " }).settings.path, "/x/y.json");
  const bad = ["/", "/a/", "/a//b", "/a/../b", "..", "./x", "/a?b", "/a#b", "/a%2e", "a\\b"];
  for (const value of bad) {
    const r = run({ path: value });
    assert.equal(r.settings.path, "/kilo.jsonc", value);
    assert.deepEqual(r.warnings, [optWarn("path", NOT_ALLOWED)], value);
  }
});

test("org, project and repo character rejections", () => {
  const bad = ["a/b", "a?b", "a#b", "a%b", "a\\b", ".", "..", "a\u0001b", "a\u007fb", "a\tb"];
  for (const name of ["org", "project", "repo"]) {
    for (const value of bad) {
      const r = run({ [name]: value });
      assert.equal((r.settings as unknown as Record<string, unknown>)[name], undefined, `${name} ${value}`);
      assert.deepEqual(r.warnings, [optWarn(name, NOT_ALLOWED)], `${name} ${value}`);
      assert.equal(r.missing.includes(name as "org"), true);
    }
  }
  assert.equal(run({ project: "my project" }).settings.project, "my project");
  assert.equal(run({ org: "a.b" }).settings.org, "a.b");
});

test("branch rules", () => {
  assert.equal(run({ branch: "feature/x" }).settings.branch, "feature/x");
  assert.equal(run({ branch: "release/1.0" }).settings.branch, "release/1.0");
  for (const value of ["a b", "a..b", "/a", "a/", "a//b", "a?b", "a#b", "a%b", "a\\b", "a\u0000b"]) {
    const r = run({ branch: value });
    assert.equal(r.settings.branch, "main", value);
    assert.deepEqual(r.warnings, [optWarn("branch", NOT_ALLOWED)], value);
  }
});

test("invalid env values fall to the default with env warnings", () => {
  const r = run(undefined, { KILO_AZDO_ORG: "a/b", KILO_AZDO_PATH: "/x/", KILO_AZDO_BRANCH: "a b" });
  assert.equal(r.settings.org, undefined);
  assert.equal(r.settings.path, "/kilo.jsonc");
  assert.equal(r.settings.branch, "main");
  assert.deepEqual(r.warnings, [
    envWarn("org", NOT_ALLOWED),
    envWarn("path", NOT_ALLOWED),
    envWarn("branch", NOT_ALLOWED),
  ]);
});

test("wrongly typed pat gives W1 and never throws", () => {
  const r = run({ pat: 12345 }, {});
  assert.equal(r.settings.pat, undefined);
  assert.deepEqual(r.warnings, [optWarn("pat", NOT_STRING)]);
});

// AC-6
test("PAT sentinel never appears in missing, warnings or serialised settings", () => {
  const inputs: Array<[unknown, Env]> = [
    [{ pat: SENTINEL }, {}],
    [{ pat: `  ${SENTINEL}  ` }, {}],
    [{}, { KILO_AZDO_PAT: SENTINEL }],
    [{ pat: [SENTINEL] }, {}],
    [{ pat: { token: SENTINEL } }, {}],
    [{ org: `PAT-SENTINEL/1234`, pat: SENTINEL }, { KILO_AZDO_BRANCH: `${SENTINEL} x` }],
    [{ timeoutMs: SENTINEL, mode: SENTINEL, path: SENTINEL + "?" }, { KILO_AZDO_PAT: SENTINEL }],
    [[SENTINEL], { KILO_AZDO_PAT: SENTINEL }],
    [SENTINEL, {}],
  ];
  for (const [options, env] of inputs) {
    const r = run(options, env);
    assert.equal(JSON.stringify({ missing: r.missing, warnings: r.warnings }).includes("SENTINEL"), false);
    assert.equal(JSON.stringify(r.settings).includes("SENTINEL"), false);
    assert.equal(Object.keys(r.settings).includes("pat"), false);
    assert.equal(JSON.stringify({ ...r.settings }).includes("SENTINEL"), false);
  }
});

test("pat property is non-enumerable, read-only and non-configurable", () => {
  const r = run({ pat: SENTINEL });
  assert.equal(r.settings.pat, SENTINEL);
  const d = Object.getOwnPropertyDescriptor(r.settings, "pat");
  assert.ok(d);
  assert.equal(d.enumerable, false);
  assert.equal(d.writable, false);
  assert.equal(d.configurable, false);
  const undef = Object.getOwnPropertyDescriptor(run({}).settings, "pat");
  assert.ok(undef);
  assert.equal(undef.enumerable, false);
});

test("a pat given in env and option uses the option", () => {
  assert.equal(pat(run({ pat: "a-fake-option" }, { KILO_AZDO_PAT: "a-fake-env" })), "a-fake-option");
});

// AC-7
test("inputs are not mutated, frozen inputs work", () => {
  const options = { org: "o", project: " p ", timeoutMs: "100", nested: { x: 1 } };
  const env: Env = { KILO_AZDO_REPO: "r", KILO_AZDO_MODE: "bad" };
  const optionsBefore = structuredClone(options);
  const envBefore = { ...env };
  const deps = { env };
  run(options, env);
  resolveSettings(options, deps);
  assert.deepEqual(options, optionsBefore);
  assert.deepEqual(env, envBefore);
  assert.deepEqual(Object.keys(deps), ["env"]);
  const frozenOptions = Object.freeze({ org: "o", mode: "enforce" });
  const frozenEnv = Object.freeze({ KILO_AZDO_REPO: "r" }) as Env;
  const r = resolveSettings(frozenOptions, Object.freeze({ env: frozenEnv }));
  assert.equal(r.settings.org, "o");
  assert.equal(r.settings.repo, "r");
});

test("results are fresh objects on every call", () => {
  const a = run({ org: "o" });
  const b = run({ org: "o" });
  assert.notEqual(a.settings, b.settings);
  assert.notEqual(a.missing, b.missing);
  a.missing.push("org");
  assert.deepEqual(b.missing, ["project", "repo"]);
});

test("inherited env and option values are ignored", () => {
  const env = Object.create({ KILO_AZDO_ORG: "inh" }) as Env;
  assert.equal(run(undefined, env).settings.org, undefined);
  assert.equal(resolveSettings(undefined, { env }).settings.org, undefined);
  const options = Object.create({ org: "inh" });
  assert.equal(run(options).settings.org, undefined);
  assert.deepEqual(run(options).missing, ["org", "project", "repo"]);
});

test("accessor properties are never invoked", () => {
  let calls = 0;
  const options = {};
  Object.defineProperty(options, "org", {
    enumerable: true,
    get() {
      calls++;
      throw new Error("getter must not run");
    },
  });
  const env = {};
  Object.defineProperty(env, "KILO_AZDO_REPO", {
    enumerable: true,
    get() {
      calls++;
      throw new Error("getter must not run");
    },
  });
  const r = resolveSettings(options, { env: env as Env });
  assert.equal(r.settings.org, undefined);
  assert.equal(r.settings.repo, undefined);
  assert.equal(calls, 0);
});

test("prototype-polluting keys in options are never read or copied", () => {
  const options = JSON.parse(
    '{"__proto__":{"polluted":1},"constructor":{"x":1},"prototype":{"y":1},"org":"o"}',
  ) as unknown;
  const r = run(options);
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
  assert.equal(r.settings.org, "o");
  assert.equal(Object.getPrototypeOf(r.settings), Object.prototype);
  for (const key of ["__proto__", "constructor", "prototype", "polluted"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(r.settings, key), false, key);
  }
});

test("throwing and revoked proxies never throw", () => {
  const throwing = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw new Error("trap");
      },
      get() {
        throw new Error("trap");
      },
    },
  );
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  for (const proxy of [throwing, revocable.proxy]) {
    assert.doesNotThrow(() => run(proxy, {}));
    assert.doesNotThrow(() => resolveSettings({}, { env: proxy as Env }));
    assert.doesNotThrow(() => resolveSettings(proxy, { env: proxy as Env }));
    assert.doesNotThrow(() => resolveSettings(undefined, proxy as never));
  }
  assert.equal(run(throwing, { KILO_AZDO_ORG: "e" }).settings.org, "e");
  assert.deepEqual(run(revocable.proxy).warnings, [W0]);
  assert.deepEqual(run(throwing).warnings, []);
  assert.deepEqual(resolveSettings({ org: "o" }, { env: revocable.proxy as Env }).warnings, []);
});

// Env deps
test("malformed deps.env is an empty env, not process.env", () => {
  const key = "KILO_AZDO_ORG";
  const saved = process.env[key];
  process.env[key] = "real-env-org";
  try {
    for (const env of [null, "x", [], 5, true]) {
      const r = resolveSettings(undefined, { env } as never);
      assert.equal(r.settings.org, undefined, String(env));
      assert.deepEqual(r.warnings, []);
    }
  } finally {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

test("omitted deps reads process.env at call time", () => {
  const key = "KILO_AZDO_BRANCH";
  const saved = process.env[key];
  try {
    process.env[key] = "unique-branch-f004";
    assert.equal(resolveSettings().settings.branch, "unique-branch-f004");
    assert.equal(resolveSettings({}, {}).settings.branch, "unique-branch-f004");
    assert.equal(resolveSettings({}, { env: undefined }).settings.branch, "unique-branch-f004");
    process.env[key] = "changed-branch-f004";
    assert.equal(resolveSettings(undefined).settings.branch, "changed-branch-f004");
  } finally {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

// Warning order
test("warnings follow setting order, option before env", () => {
  const options = {
    org: "a/b",
    project: 1,
    repo: "a?b",
    path: "/",
    branch: "a b",
    mode: "nope",
    pat: 7,
    timeoutMs: 0,
  };
  const env: Env = {
    KILO_AZDO_ORG: "c/d",
    KILO_AZDO_PROJECT: "c#d",
    KILO_AZDO_REPO: "c%d",
    KILO_AZDO_PATH: "/c/",
    KILO_AZDO_BRANCH: "c d",
    KILO_AZDO_MODE: "nope",
    KILO_AZDO_PAT: "   ",
    KILO_AZDO_TIMEOUT_MS: "abc",
  };
  assert.deepEqual(run(options, env).warnings, [
    optWarn("org", NOT_ALLOWED),
    envWarn("org", NOT_ALLOWED),
    optWarn("project", NOT_STRING),
    envWarn("project", NOT_ALLOWED),
    optWarn("repo", NOT_ALLOWED),
    envWarn("repo", NOT_ALLOWED),
    optWarn("path", NOT_ALLOWED),
    envWarn("path", NOT_ALLOWED),
    optWarn("branch", NOT_ALLOWED),
    envWarn("branch", NOT_ALLOWED),
    optWarn("mode", MODE_HINT),
    envWarn("mode", MODE_HINT),
    optWarn("pat", NOT_STRING),
    optWarn("timeoutMs", TIMEOUT_HINT),
    envWarn("timeoutMs", TIMEOUT_HINT),
  ]);
});

test("W0 comes first, before setting warnings", () => {
  const r = run(["x"], { KILO_AZDO_ORG: "a/b" });
  assert.deepEqual(r.warnings, [W0, envWarn("org", NOT_ALLOWED)]);
});
