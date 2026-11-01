import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(backendRoot, "tools", "compare-plugin-shape.mjs");
const dir = mkdtempSync(join(tmpdir(), "shape-"));
let counter = 0;

after(() => rmSync(dir, { recursive: true, force: true }));

function write(content: string): string {
  counter += 1;
  const file = join(dir, `f${counter}.ts`);
  writeFileSync(file, content);
  return file;
}

function compare(base: string, head: string) {
  const result = spawnSync(process.execPath, [script, "--base-file", write(base), "--head-file", write(head)], {
    encoding: "utf8",
  });
  return { status: result.status, out: result.stdout, err: result.stderr };
}

const BASE = [
  'import { join } from "node:path";',
  "",
  "export const NAME = 'x';",
  "",
  "function one(a: number): number {",
  "  return a > 1 ? 1 : 2;",
  "}",
  "",
  "async function two(): Promise<string> {",
  "  return `v${one(1)}`;",
  "}",
  "",
  "export const __internals = {",
  "  one,",
  "  two,",
  "};",
  "",
  "export default { id: NAME, join };",
  "",
].join("\n");

test("identical source passes and reports counts", () => {
  const r = compare(BASE, BASE);
  assert.equal(r.status, 0);
  assert.match(r.out, /declarations: 4 identical/);
  assert.match(r.out, /exports: 3 identical [(]NAME, __internals, default[)]/);
  assert.match(r.out, /__internals keys: 2 identical \(one, two\)/);
  assert.match(r.out, /compare-plugin-shape: PASS\s*$/);
});

test("reordered declarations, added JSDoc and banners, CRLF head still pass", () => {
  const head = [
    "// ==== 1. Section ====",
    "",
    'import { join } from "node:path";',
    "",
    "/** Docs for NAME. */",
    "export const NAME = 'x';",
    "",
    "/**",
    " * Two.",
    " */",
    "async function two(): Promise<string> {",
    "  return `v${one(1)}`;",
    "}",
    "",
    "function one(a: number): number {",
    "  return a > 1 ? 1 : 2; // trailing",
    "}",
    "",
    "export const __internals = { one, two, };",
    "",
    "export default { id: NAME, join };",
    "",
  ].join("\r\n");
  const r = compare(BASE, head);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /PASS/);
});

test("whitespace changed inside a string fails", () => {
  const r = compare(BASE.replace("'x'", "'x '"), BASE);
  assert.equal(r.status, 1);
  assert.match(r.out, /only in base: .*'x '/);
  assert.match(r.out, /compare-plugin-shape: FAIL\s*$/);
});

test("operator change fails", () => {
  const r = compare(BASE, BASE.replace("a > 1", "a >= 1"));
  assert.equal(r.status, 1);
  assert.match(r.out, /only in head: .*a > = 1/);
});

test("renamed function fails with a declarations difference", () => {
  const r = compare(BASE, BASE.replaceAll("two", "three"));
  assert.equal(r.status, 1);
  assert.match(r.out, /declarations: DIFFERENT/);
  assert.match(r.out, /only in base: two/);
  assert.match(r.out, /only in head: three/);
});

test("extra __internals key fails", () => {
  const r = compare(BASE, BASE.replace("  two,\n};", "  two,\n  NAME,\n};"));
  assert.equal(r.status, 1);
  assert.match(r.out, /__internals keys: DIFFERENT/);
  assert.match(r.out, /only in head: NAME/);
});

test("dropped export fails", () => {
  const r = compare(BASE, BASE.replace("export const NAME", "const NAME"));
  assert.equal(r.status, 1);
  assert.match(r.out, /exports: DIFFERENT/);
});

test("double slash inside a string is not a comment", () => {
  const base = 'const URL_A = "https://a/b";\nconst B = 1;\n';
  assert.equal(compare(base, base).status, 0);
  const r = compare(base, 'const URL_A = "https://a/";\nconst B = 1;\n');
  assert.equal(r.status, 1);
  assert.match(r.out, /only in base: const URL_A = "https:\/\/a\/b" ;/);
});

test("regex literal with braces and escaped slashes moves, edited fails", () => {
  const rx = "const RX = /[{}]\\/\\/x{2}/g;\n";
  const a = `function f() {\n  return 1;\n}\n${rx}`;
  const b = `${rx}function f() {\n  return 1;\n}\n`;
  assert.equal(compare(a, b).status, 0);
  const r = compare(a, b.replace("x{2}", "x{3}"));
  assert.equal(r.status, 1);
  assert.match(r.out, /only in head: const RX/);
});

test("nested template literal moves, edited fails", () => {
  const t = "const T = `a${`b${1 + 1}c`}d`;\n";
  const a = `${t}const U = 2;\n`;
  const b = `const U = 2;\n${t}`;
  assert.equal(compare(a, b).status, 0);
  assert.equal(compare(a, b.replace("1 + 1", "1 + 2")).status, 1);
});

test("unterminated literal or comment is a tokenizer error (exit 2)", () => {
  assert.equal(compare(BASE, 'const A = "open;\n').status, 2);
  assert.equal(compare(BASE, "const A = `open;\n").status, 2);
  const r = compare(BASE, "/* open\nconst A = 1;\n");
  assert.equal(r.status, 2);
  assert.match(r.err, /unterminated block comment/);
});

test("unknown base ref skips with exit 0", () => {
  const r = spawnSync(process.execPath, [script, "--base-ref", "no-such-ref-xyz", "--head-file", write(BASE)], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /compare-plugin-shape: SKIP - base no-such-ref-xyz unavailable \(no git history\)/);
});

test("bad arguments exit 2", () => {
  const head = write(BASE);
  const cases = [
    ["--unknown", "x"],
    ["--base-ref"],
    ["--base-ref", "HEAD", "--base-file", head],
    ["--base-ref", "-evil", "--head-file", head],
    ["--base-ref", "a b", "--head-file", head],
    ["--head-file", head, "--head-file", head],
  ];
  for (const args of cases) {
    const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /^compare-plugin-shape: /);
  }
});

test("missing file exits 2", () => {
  const r = spawnSync(process.execPath, [script, "--base-file", join(dir, "absent.ts"), "--head-file", write(BASE)], {
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
});
