import assert from "node:assert/strict";
import { test } from "node:test";
import { __internals } from "../../plugin/azdo-remote-config.ts";

const { mergeConfig } = __internals;
const MODES = ["defaults", "enforce"] as const;
const TOO_DEEP = /^Error: Config merge: config nested too deeply$/;

type Obj = Record<string, any>;

function parse(text: string): Obj {
  return JSON.parse(text) as Obj;
}

function nested(containers: number): Obj {
  let node: Obj = {};
  for (let i = 1; i < containers; i++) node = { a: node };
  return node;
}

function merge(target: Obj, shared: unknown, mode?: unknown): Obj {
  mergeConfig(target, shared, mode);
  return target;
}

// AC-1
test("defaults mode: local wins, shared-only keys are added", () => {
  const t = merge({ model: "a" }, { model: "b", small_model: "s" }, "defaults");
  assert.equal(t.model, "a");
  assert.equal(t.small_model, "s");
});

test("enforce mode: shared wins, shared-only keys are added", () => {
  const t = merge({ model: "a" }, { model: "b", small_model: "s" }, "enforce");
  assert.equal(t.model, "b");
  assert.equal(t.small_model, "s");
});

// AC-2
test("nested conflict resolves per mode", () => {
  const local = () => ({ model: "a", provider: { bifrost: { options: { baseURL: "L" } } } });
  const shared = { model: "b", provider: { bifrost: { options: { baseURL: "S" } } } };
  const e = merge(local(), shared, "enforce");
  assert.equal(e.model, "b");
  assert.equal(e.provider.bifrost.options.baseURL, "S");
  const d = merge(local(), shared, "defaults");
  assert.equal(d.model, "a");
  assert.equal(d.provider.bifrost.options.baseURL, "L");
});

// AC-3
test("shared apiKey never replaces the local apiKey in either mode", () => {
  for (const mode of MODES) {
    const t = merge(
      { provider: { bifrost: { options: { apiKey: "sk-bf-local", baseURL: "L" } } } },
      { provider: { bifrost: { options: { apiKey: "sk-bf-shared", baseURL: "S" } } } },
      mode,
    );
    assert.equal(t.provider.bifrost.options.apiKey, "sk-bf-local");
    assert.equal(t.provider.bifrost.options.baseURL, mode === "enforce" ? "S" : "L");
  }
});

test("shared apiKey is not added when the local config has none", () => {
  for (const mode of MODES) {
    const t = merge(
      { provider: { bifrost: { options: {} } } },
      { provider: { bifrost: { options: { apiKey: "sk-bf-shared", baseURL: "S" } } } },
      mode,
    );
    assert.deepEqual(t.provider.bifrost.options, { baseURL: "S" });
  }
});

test("apiKey is dropped in any case and at the top level", () => {
  for (const mode of MODES) {
    const t = merge(
      {},
      { apiKey: "x", apikey: "x", APIKEY: "x", ApiKey: "x", nested: { aPiKeY: "x", keep: 1 } },
      mode,
    );
    assert.deepEqual(t, { nested: { keep: 1 } });
  }
});

test("apiKey is dropped inside arrays and inside new subtrees", () => {
  for (const mode of MODES) {
    const t = merge({}, { list: [{ apiKey: "x", n: 1 }, [{ APIKEY: "x" }]], fresh: { a: { b: { apiKey: "x" } } } }, mode);
    assert.deepEqual(t, { list: [{ n: 1 }, [{}]], fresh: { a: { b: {} } } });
  }
});

test("enforce keeps a local object or array that contains an apiKey at any depth", () => {
  const t = merge(
    {
      a: { deep: { ApiKey: "sk-bf-local" } },
      b: [{ x: { apikey: "sk-bf-local" } }],
      c: { plain: 1 },
    },
    { a: "scalar", b: ["s"], c: "scalar" },
    "enforce",
  );
  assert.deepEqual(t.a, { deep: { ApiKey: "sk-bf-local" } });
  assert.deepEqual(t.b, [{ x: { apikey: "sk-bf-local" } }]);
  assert.equal(t.c, "scalar");
});

// AC-4
test("local keys absent from shared are unchanged in both modes", () => {
  for (const mode of MODES) {
    const t = merge(
      {
        top: 1,
        provider: { other: { x: 1 }, bifrost: { options: { headers: { h: "v" }, baseURL: "L" } } },
        agent: { x: { p: 1 } },
      },
      { provider: { bifrost: { options: { baseURL: "S" } } } },
      mode,
    );
    assert.equal(t.top, 1);
    assert.deepEqual(t.provider.other, { x: 1 });
    assert.deepEqual(t.provider.bifrost.options.headers, { h: "v" });
    assert.deepEqual(t.agent, { x: { p: 1 } });
  }
});

// AC-5
test("top-level $schema and plugin are ignored, never added, never changed", () => {
  const shared = { $schema: "s", plugin: ["p"], model: "m" };
  for (const mode of MODES) {
    const absent = merge({}, shared, mode);
    assert.deepEqual(absent, { model: "m" });
    const present = merge({ $schema: "L", plugin: ["lp"] }, shared, mode);
    assert.equal(present.$schema, "L");
    assert.deepEqual(present.plugin, ["lp"]);
  }
});

test("nested keys named plugin or $schema are ordinary data", () => {
  const t = merge({}, { agent: { plugin: 1, $schema: 2 } }, "defaults");
  assert.deepEqual(t.agent, { plugin: 1, $schema: 2 });
});

// AC-6
test("target reference and nested references are kept; shared is not mutated", () => {
  for (const mode of MODES) {
    const target: Obj = { provider: { bifrost: { options: { a: 1 } } } };
    const provider = target.provider;
    const options = target.provider.bifrost.options;
    const shared = { provider: { bifrost: { options: { b: 2 } } } };
    const snapshot = structuredClone(shared);
    mergeConfig(target, shared, mode);
    assert.equal(target.provider, provider);
    assert.equal(target.provider.bifrost.options, options);
    assert.deepEqual(shared, snapshot);
  }
});

test("mutating shared after the merge does not change target", () => {
  for (const mode of MODES) {
    const shared: Obj = { list: [{ n: 1 }], obj: { inner: { n: 1 } } };
    const t = merge({}, shared, mode);
    shared.list[0].n = 99;
    shared.list.push(3);
    shared.obj.inner.n = 99;
    assert.deepEqual(t, { list: [{ n: 1 }], obj: { inner: { n: 1 } } });
    assert.notEqual(t.list, shared.list);
    assert.notEqual(t.obj, shared.obj);
  }
});

// AC-7
test("arrays are replaced wholesale, never concatenated", () => {
  assert.deepEqual(merge({ instructions: ["a"] }, { instructions: ["b", "c"] }, "enforce").instructions, ["b", "c"]);
  assert.deepEqual(merge({ instructions: ["a"] }, { instructions: ["b", "c"] }, "defaults").instructions, ["a"]);
});

test("type conflicts resolve by mode", () => {
  assert.equal(merge({ k: { o: 1 } }, { k: "s" }, "enforce").k, "s");
  assert.deepEqual(merge({ k: { o: 1 } }, { k: "s" }, "defaults").k, { o: 1 });
  assert.deepEqual(merge({ k: "s" }, { k: { o: 1 } }, "enforce").k, { o: 1 });
  assert.equal(merge({ k: "s" }, { k: { o: 1 } }, "defaults").k, "s");
  assert.equal(merge({ k: null }, { k: 5 }, "defaults").k, null);
  assert.equal(merge({ k: null }, { k: 5 }, "enforce").k, 5);
  assert.deepEqual(merge({ k: [1] }, { k: { o: 1 } }, "enforce").k, { o: 1 });
});

test("unrecognised modes behave as defaults", () => {
  for (const mode of [undefined, null, "", "ENFORCE", "Enforce", "enforce ", 1, true, {}, ["enforce"]]) {
    assert.deepEqual(merge({ k: "local" }, { k: "shared", n: 1 }, mode), { k: "local", n: 1 });
  }
});

test("a local undefined value counts as absent in both modes", () => {
  for (const mode of MODES) {
    assert.equal(merge({ k: undefined }, { k: "s" }, mode).k, "s");
  }
});

// AC-8
test("prototype keys from JSON.parse are skipped at top level, nested and in arrays", () => {
  const shared = parse(
    '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"prototype":{"polluted":3},' +
      '"a":{"__proto__":{"polluted":4},"ok":1},"list":[{"__proto__":{"polluted":5},"constructor":1,"n":2}]}',
  );
  for (const mode of MODES) {
    const t = merge({}, shared, mode);
    assert.equal(({} as Obj).polluted, undefined);
    assert.equal(Object.getPrototypeOf(t), Object.prototype);
    assert.deepEqual(Object.keys(t), ["a", "list"]);
    assert.deepEqual(t.a, { ok: 1 });
    assert.deepEqual(t.list, [{ n: 2 }]);
    assert.equal(Object.getPrototypeOf(t.a), Object.prototype);
    assert.equal(Object.hasOwn(t, "__proto__"), false);
  }
});

test("prototype keys do not touch own keys of the target", () => {
  const target = parse('{"__proto__":{"mine":1}}');
  merge(target, parse('{"__proto__":{"theirs":1},"x":1}'), "enforce");
  assert.deepEqual(Object.keys(target), ["__proto__", "x"]);
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, "__proto__")?.value, { mine: 1 });
  assert.equal(({} as Obj).theirs, undefined);
});

test("works with a null-prototype target", () => {
  const target = Object.assign(Object.create(null) as Obj, { a: 1 });
  merge(target, { a: 2, b: 3 }, "enforce");
  assert.equal(target.a, 2);
  assert.equal(target.b, 3);
  assert.equal(Object.getPrototypeOf(target), null);
});

test("depth: 64 nested containers merge, 65 throw", () => {
  for (const mode of MODES) {
    const ok = merge({}, nested(64), mode);
    let depth = 0;
    for (let n: Obj | undefined = ok; n; n = n.a) depth++;
    assert.equal(depth, 64);
    assert.throws(() => mergeConfig({}, nested(65), mode), TOO_DEEP);
  }
});

test("depth counts arrays as containers", () => {
  let ok: unknown = [];
  for (let i = 0; i < 62; i++) ok = [ok];
  assert.doesNotThrow(() => mergeConfig({}, { v: ok }));
  assert.throws(() => mergeConfig({}, { v: [ok] }), TOO_DEEP);
});

test("cyclic shared throws the fixed error and leaves target unchanged", () => {
  const shared: Obj = { first: 1 };
  shared.self = shared;
  const target = { keep: 1 };
  assert.throws(() => mergeConfig(target, shared, "enforce"), TOO_DEEP);
  assert.deepEqual(target, { keep: 1 });
  const arr: unknown[] = [];
  arr.push(arr);
  assert.throws(() => mergeConfig({}, { arr }), TOO_DEEP);
});

test("target is unchanged when the depth check throws after earlier keys", () => {
  for (const mode of MODES) {
    const target = { model: "a", fresh: undefined as unknown };
    const snapshot = { ...target };
    assert.throws(() => mergeConfig(target, { model: "b", fresh: 1, late: nested(65) }, mode), TOO_DEEP);
    assert.deepEqual(target, snapshot);
    assert.equal(Object.keys(target).length, 2);
  }
});

test("deep local value under enforce conflict does not throw and is kept", () => {
  const local = nested(70);
  const t = merge({ k: local }, { k: "s" }, "enforce");
  assert.equal(t.k, local);
});

test("cyclic local value under enforce conflict does not throw and is kept", () => {
  const local: Obj = { x: 1 };
  local.self = local;
  const t = merge({ k: local }, { k: "s" }, "enforce");
  assert.equal(t.k, local);
  const arr: unknown[] = [];
  arr.push(arr);
  assert.equal(merge({ k: arr }, { k: "s" }, "enforce").k, arr);
});

test("non-object inputs are a no-op and never throw", () => {
  const values = [null, undefined, "s", 1, true, [], [{ a: 1 }], () => 1, new Date(), new Map()];
  for (const bad of values) {
    assert.doesNotThrow(() => mergeConfig(bad, { a: 1 }, "enforce"));
    const target = { a: 0 };
    assert.doesNotThrow(() => mergeConfig(target, bad, "enforce"));
    assert.deepEqual(target, { a: 0 });
  }
  assert.equal(mergeConfig({}, {}), undefined);
});

test("non-JSON values: omitted as object values, null as array elements, nothing aliased", () => {
  const fn = () => 1;
  const date = new Date(0);
  const shared = { u: undefined, f: fn, s: Symbol("x"), b: 10n, d: date, list: [undefined, fn, date, 1] };
  const t = merge({}, shared, "defaults");
  assert.deepEqual(t, { list: [null, null, null, 1] });
});

test("key order: existing keys keep position, new keys are appended in shared order", () => {
  const t = merge({ b: 1, a: 1 }, { z: 1, a: 2, y: 1, b: 2 }, "enforce");
  assert.deepEqual(Object.keys(t), ["b", "a", "z", "y"]);
});

test("scalar leaves are copied as is", () => {
  const t = merge({}, { n: 1.5, b: false, nul: null, s: "x" }, "defaults");
  assert.deepEqual(t, { n: 1.5, b: false, nul: null, s: "x" });
});
