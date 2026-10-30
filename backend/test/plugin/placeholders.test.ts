import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { __internals } from "../../plugin/azdo-remote-config.ts";

const { resolvePlaceholders } = __internals;
const CANARY = "SECRET-CANARY-42";
const FAKE_HOME = join(tmpdir(), "fake-home-for-tests");
const ENV = { SET_VAR: "abc", A: "a", B: "b" };

type Obj = Record<string, unknown>;

function spyReader(result: unknown) {
  const paths: string[] = [];
  const readFile = (path: string) => {
    paths.push(path);
    return result as string;
  };
  return { paths, readFile };
}

function withTempDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "placeholders-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("AC-1: {env:NAME} resolves to the variable value", () => {
  const r = resolvePlaceholders({ x: "{env:SET_VAR}" }, { env: ENV });
  assert.deepEqual(r.value, { x: "abc" });
  assert.deepEqual(r.unresolved, []);
});

test("AC-1: default env is process.env, read at call time", () => {
  process.env.PLACEHOLDER_TEST_VAR = "from-process";
  try {
    assert.deepEqual(resolvePlaceholders("x{env:PLACEHOLDER_TEST_VAR}").value, "xfrom-process");
  } finally {
    delete process.env.PLACEHOLDER_TEST_VAR;
  }
});

test("AC-2: a missing env var drops the key and is listed by name", () => {
  const r = resolvePlaceholders({ x: "{env:MISSING}", y: 1 }, { env: {} });
  const value = r.value as Obj;
  assert.equal("x" in value, false);
  assert.equal(value.y, 1);
  assert.deepEqual(r.unresolved, ["env:MISSING"]);
});

test("AC-2: empty and inherited env names are unresolved", () => {
  const env = { EMPTY: "", UNDEF: undefined };
  for (const name of ["EMPTY", "UNDEF", "constructor", "toString", "__proto__"]) {
    const r = resolvePlaceholders({ k: `{env:${name}}` }, { env });
    assert.deepEqual(r.value, {}, name);
    assert.deepEqual(r.unresolved, [`env:${name}`], name);
  }
});

test("AC-3: a partially unresolved string resolves the missing part to empty", () => {
  const r = resolvePlaceholders("pre-{env:MISSING}-post", { env: {} });
  assert.equal(r.value, "pre--post");
  assert.deepEqual(r.unresolved, ["env:MISSING"]);
});

test("AC-3: two adjacent unresolved placeholders give an empty string that is kept", () => {
  const r = resolvePlaceholders({ k: "{env:M1}{env:M2}" }, { env: {} });
  assert.deepEqual(r.value, { k: "" });
  assert.deepEqual(r.unresolved, ["env:M1", "env:M2"]);
});

test("AC-4: {file:~/path} expands the home directory and trims the content", () => {
  const spy = spyReader("  s3cret\n");
  const r = resolvePlaceholders({ x: "{file:~/secret.txt}" }, { homedir: () => FAKE_HOME, readFile: spy.readFile });
  assert.deepEqual(r.value, { x: "s3cret" });
  assert.deepEqual(r.unresolved, []);
  assert.deepEqual(spy.paths, [join(FAKE_HOME, "secret.txt")]);
});

test("AC-4: {file:~\\path} also expands the home directory", () => {
  const spy = spyReader("v");
  const r = resolvePlaceholders({ x: "{file:~\\secret.txt}" }, { homedir: () => FAKE_HOME, readFile: spy.readFile });
  assert.deepEqual(r.value, { x: "v" });
  assert.deepEqual(spy.paths, [join(FAKE_HOME, "secret.txt")]);
});

test("AC-4: an absolute path is read as is, with a BOM stripped, using the default reader", () => {
  withTempDir((dir) => {
    const file = join(dir, "key.txt");
    writeFileSync(file, "\uFEFFfile-value\r\n");
    const r = resolvePlaceholders({ x: `{file:${file}}` });
    assert.deepEqual(r.value, { x: "file-value" });
    assert.deepEqual(r.unresolved, []);
  });
});

test("AC-4: the home directory is only requested for ~/ paths", () => {
  let calls = 0;
  const homedir = () => {
    calls++;
    return FAKE_HOME;
  };
  const abs = join(tmpdir(), "abs.txt");
  resolvePlaceholders({ x: `{file:${abs}}` }, { homedir, readFile: () => "v" });
  assert.equal(calls, 0);
});

test("AC-5: a missing file with the default reader drops the key", () => {
  withTempDir((dir) => {
    const missing = join(dir, "does-not-exist.txt");
    const r = resolvePlaceholders({ x: `{file:${missing}}`, y: 2 });
    assert.deepEqual(r.value, { y: 2 });
    assert.deepEqual(r.unresolved, [`file:${missing}`]);
  });
});

test("AC-5: a directory with the default reader drops the key", () => {
  withTempDir((dir) => {
    const r = resolvePlaceholders({ x: `{file:${dir}}` });
    assert.deepEqual(r.value, {});
    assert.deepEqual(r.unresolved, [`file:${dir}`]);
  });
});

test("AC-5: a file larger than the cap with the default reader is unresolved", () => {
  withTempDir((dir) => {
    const big = join(dir, "big.txt");
    writeFileSync(big, "a".repeat(1024 * 1024 + 1));
    const small = join(dir, "small.txt");
    writeFileSync(small, "ok");
    const r = resolvePlaceholders({ x: `{file:${big}}`, y: `{file:${small}}` });
    assert.deepEqual(r.value, { y: "ok" });
    assert.deepEqual(r.unresolved, [`file:${big}`]);
  });
});

test("AC-5: /dev/zero with the default reader is unresolved and returns quickly", { skip: process.platform === "win32" }, () => {
  const started = Date.now();
  const r = resolvePlaceholders({ x: "{file:/dev/zero}" });
  assert.deepEqual(r.value, {});
  assert.deepEqual(r.unresolved, ["file:/dev/zero"]);
  assert.ok(Date.now() - started < 2000);
});

test("AC-5: UNC-style paths are unresolved and never read", () => {
  const spy = spyReader(CANARY);
  let homedirCalls = 0;
  const homedir = () => {
    homedirCalls += 1;
    return FAKE_HOME;
  };
  const paths = ["\\\\host\\share\\x", "//host/share/x", "\\/host/share/x", "/\\host\\share\\x", "\\\\host\\share\\f.txt", "//host/share/f.txt"];
  for (const path of paths) {
    const r = resolvePlaceholders({ x: `{file:${path}}` }, { readFile: spy.readFile, homedir });
    assert.deepEqual(r.value, {}, path);
    assert.deepEqual(r.unresolved, [`file:${path}`]);
  }
  assert.equal(spy.paths.length, 0);
  assert.equal(homedirCalls, 0);
});

test("AC-5: a throwing reader never leaks its error text", () => {
  const abs = join(tmpdir(), "x.txt");
  const readFile = () => {
    throw new Error(CANARY);
  };
  const r = resolvePlaceholders({ x: `{file:${abs}}` }, { readFile });
  assert.deepEqual(r.value, {});
  assert.deepEqual(r.unresolved, [`file:${abs}`]);
  assert.equal(JSON.stringify(r).includes(CANARY), false);
});

test("AC-5: a throwing homedir never leaks its error text", () => {
  const homedir = () => {
    throw new Error(CANARY);
  };
  const spy = spyReader("v");
  const r = resolvePlaceholders({ x: "{file:~/k.txt}" }, { homedir, readFile: spy.readFile });
  assert.deepEqual(r.value, {});
  assert.deepEqual(r.unresolved, ["file:~/k.txt"]);
  assert.equal(JSON.stringify(r).includes(CANARY), false);
  assert.equal(spy.paths.length, 0);
});

test("AC-5: non-string and whitespace-only reader results are unresolved", () => {
  const abs = join(tmpdir(), "x.txt");
  for (const result of [undefined, null, 42, {}, "", "  \n\t "]) {
    const r = resolvePlaceholders({ x: `{file:${abs}}` }, { readFile: spyReader(result).readFile });
    assert.deepEqual(r.value, {}, String(result));
    assert.deepEqual(r.unresolved, [`file:${abs}`]);
  }
});

test("AC-5: relative, bare ~ and ~user paths are unresolved and never read", () => {
  const spy = spyReader(CANARY);
  for (const path of ["secret.txt", "./secret.txt", "../secret.txt", "~", "~user/x"]) {
    const r = resolvePlaceholders({ x: `{file:${path}}` }, { homedir: () => FAKE_HOME, readFile: spy.readFile });
    assert.deepEqual(r.value, {}, path);
    assert.deepEqual(r.unresolved, [`file:${path}`]);
    assert.equal(JSON.stringify(r).includes(CANARY), false);
  }
  assert.equal(spy.paths.length, 0);
});

test("AC-6: nested arrays and objects drop unresolved elements and keep the rest", () => {
  const input = { a: { b: ["{env:SET_VAR}", "{env:MISSING}", "keep"] } };
  const r = resolvePlaceholders(input, { env: ENV });
  assert.deepEqual(r.value, { a: { b: ["abc", "keep"] } });
  assert.deepEqual(r.unresolved, ["env:MISSING"]);
});

test("AC-6: other types, empty containers and plain strings are unchanged", () => {
  const input = { n: 1, f: 1.5, t: true, z: null, o: {}, a: [], s: "plain text", nested: { o: {}, a: [[]] } };
  const r = resolvePlaceholders(input, { env: {} });
  assert.deepEqual(r.value, input);
  assert.deepEqual(r.unresolved, []);
  assert.deepEqual(resolvePlaceholders(7).value, 7);
  assert.equal(resolvePlaceholders(null).value, null);
  assert.equal(resolvePlaceholders(false).value, false);
});

test("AC-6: text that is not a placeholder stays literal", () => {
  const literals = ["{env:}", "{foo:x}", "{env:X", "env:X}", "{ env:X }"];
  const r = resolvePlaceholders(literals, { env: ENV });
  assert.deepEqual(r.value, literals);
  assert.deepEqual(r.unresolved, []);
});

test("AC-6: a root string that is only an unresolved placeholder gives undefined", () => {
  const r = resolvePlaceholders("{env:MISSING}", { env: {} });
  assert.equal(r.value, undefined);
  assert.deepEqual(r.unresolved, ["env:MISSING"]);
});

test("AC-6: names are used verbatim (no trimming, no case folding)", () => {
  const r = resolvePlaceholders(["{env:set_var}", "{env: SET_VAR}"], { env: ENV });
  assert.deepEqual(r.value, []);
  assert.deepEqual(r.unresolved, ["env:set_var", "env: SET_VAR"]);
});

test("AC-7: the input is not mutated", () => {
  const input = { a: ["{env:SET_VAR}", "{env:MISSING}"], b: { c: "{file:rel.txt}" } };
  const before = structuredClone(input);
  const r = resolvePlaceholders(input, { env: ENV });
  assert.deepEqual(input, before);
  assert.notEqual(r.value, input);
  assert.notEqual((r.value as Obj).a, input.a);
});

test("AC-7: __proto__, constructor and prototype keys do not pollute", () => {
  const raw =
    '{"__proto__":{"polluted":"{env:SET_VAR}"},"constructor":{"prototype":{"p2":1}},"prototype":"{env:SET_VAR}"}';
  const input = JSON.parse(raw);
  const value = resolvePlaceholders(input, { env: ENV }).value as Obj;
  assert.equal(({} as Obj).polluted, undefined);
  assert.equal(({} as Obj).p2, undefined);
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(value, "__proto__"), true);
  const own = Object.getOwnPropertyDescriptor(value, "__proto__")?.value as Obj;
  assert.deepEqual(own, { polluted: "abc" });
  assert.deepEqual(value.constructor, { prototype: { p2: 1 } });
  assert.equal(value.prototype, "abc");
  assert.deepEqual(JSON.parse(JSON.stringify(value)), {
    ["__proto__"]: { polluted: "abc" },
    constructor: { prototype: { p2: 1 } },
    prototype: "abc",
  });
});

test("AC-7: several placeholders in one string all resolve", () => {
  assert.equal(resolvePlaceholders("{env:A}/{env:B}", { env: ENV }).value, "a/b");
});

test("AC-7: resolved values are never expanded again", () => {
  const spy = spyReader("file-content");
  const env = { A: "{env:B}", B: "b", C: "{file:~/x}", D: "$&-$1-$$" };
  const r = resolvePlaceholders(["{env:A}", "x{env:C}", "{env:D}", "<{env:D}>"], {
    env,
    homedir: () => FAKE_HOME,
    readFile: spy.readFile,
  });
  assert.deepEqual(r.value, ["{env:B}", "x{file:~/x}", "$&-$1-$$", "<$&-$1-$$>"]);
  assert.equal(spy.paths.length, 0);
});

test("AC-7: file content is not expanded again either", () => {
  const abs = join(tmpdir(), "chain.txt");
  const r = resolvePlaceholders({ x: `{file:${abs}}` }, { env: ENV, readFile: () => "{env:SET_VAR}" });
  assert.deepEqual(r.value, { x: "{env:SET_VAR}" });
});

test("AC-7: unresolved entries are de-duplicated and in first-occurrence order", () => {
  const input = { a: "{env:Z}", b: ["{env:Y}", "{env:Z}", "p-{env:Y}-{file:rel.txt}"], c: "{file:rel.txt}" };
  const r = resolvePlaceholders(input, { env: {} });
  assert.deepEqual(r.unresolved, ["env:Z", "env:Y", "file:rel.txt"]);
});

test("AC-7: unresolved lists names as written, never values or expanded paths", () => {
  const spy = spyReader(CANARY);
  const r = resolvePlaceholders({ ok: "{file:~/k.txt}", bad: "{env:NOPE}" }, { homedir: () => FAKE_HOME, readFile: spy.readFile });
  assert.deepEqual(r.unresolved, ["env:NOPE"]);
});

function nestedArrays(levels: number): unknown {
  let node: unknown = ["{env:SET_VAR}"];
  for (let i = 1; i < levels; i++) node = [node];
  return node;
}

test("depth cap: 64 nested containers resolve, 65 throw a fixed error", () => {
  const ok = resolvePlaceholders(nestedArrays(64), { env: ENV });
  let cursor = ok.value as unknown[];
  for (let i = 1; i < 64; i++) cursor = cursor[0] as unknown[];
  assert.deepEqual(cursor, ["abc"]);
  assert.throws(
    () => resolvePlaceholders(nestedArrays(65), { env: ENV }),
    (err: unknown) => err instanceof Error && err.message === "Placeholder resolution: config nested too deeply",
  );
});

test("depth cap: cyclic input throws the fixed error instead of overflowing", () => {
  const cyclic: Obj = { name: CANARY };
  cyclic.self = cyclic;
  assert.throws(
    () => resolvePlaceholders(cyclic, { env: ENV }),
    (err: unknown) => err instanceof Error && err.message === "Placeholder resolution: config nested too deeply",
  );
});
