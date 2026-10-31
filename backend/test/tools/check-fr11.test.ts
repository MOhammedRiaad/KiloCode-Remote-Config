import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(backendRoot, "tools", "check-fr11.mjs");

function run(args: string[] = []) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

function fixture(opts: { deps?: Record<string, string>; plugin?: string; extra?: string; validator?: string; installer?: string }) {
  const root = mkdtempSync(join(tmpdir(), "fr11-"));
  mkdirSync(join(root, "plugin"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: opts.deps ?? {} }));
  writeFileSync(join(root, "plugin", "azdo-remote-config.ts"), opts.plugin ?? "export default {};\n");
  if (opts.extra) writeFileSync(join(root, "plugin", opts.extra), "export {};\n");
  if (opts.validator !== undefined) {
    mkdirSync(join(root, "validator"));
    writeFileSync(join(root, "validator", "x.ts"), opts.validator);
  }
  if (opts.installer !== undefined) {
    mkdirSync(join(root, "installer"));
    writeFileSync(join(root, "installer", "x.ts"), opts.installer);
  }
  return root;
}

function runOn(opts: Parameters<typeof fixture>[0]) {
  const root = fixture(opts);
  try {
    return run(["--root", root]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("real tree passes", () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /check-fr11: PASS/);
});

test("clean fixture passes with node: import", () => {
  const r = runOn({ plugin: 'import { tmpdir } from "node:os";\nexport default { tmpdir };\n' });
  assert.equal(r.status, 0, r.stderr);
});

test("non-empty dependencies fail", () => {
  const r = runOn({ deps: { leftpad: "1.0.0" } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /dependencies/);
});

test("npm import fails", () => {
  const r = runOn({ plugin: 'import x from "lodash";\nexport default x;\n' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /lodash/);
});

test("dynamic npm import fails", () => {
  const r = runOn({ plugin: 'export default await import("lodash");\n' });
  assert.equal(r.status, 1);
});

test("require fails", () => {
  const r = runOn({ plugin: 'const x = require("node:fs");\nexport default x;\n' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /require/);
});

test("extra file in plugin/ fails", () => {
  const r = runOn({ extra: "helper.ts" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /plugin\//);
});

test("validator: node: and sibling imports pass", () => {
  const src = [
    'import { a } from "node:fs";',
    'import { b } from "./y.ts";',
    'import { c } from "../plugin/azdo-remote-config.ts";',
    "export { a, b, c };",
    "",
  ].join("\n");
  const r = runOn({ validator: src });
  assert.equal(r.status, 0, r.stderr);
});

for (const spec of ["lodash", "../plugin/other.ts", "../../x.ts", "./y"]) {
  test(`validator: import "${spec}" fails`, () => {
    const r = runOn({ validator: `import x from "${spec}";\nexport default x;\n` });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /validator\/x\.ts/);
  });
}

test("validator: require fails", () => {
  const r = runOn({ validator: 'const x = require("node:fs");\nexport default x;\n' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /require/);
});

test("installer: node:, sibling and plugin imports pass", () => {
  const src = [
    'import { a } from "node:fs";',
    'import { b } from "./y.ts";',
    'import { c } from "../plugin/azdo-remote-config.ts";',
    "export { a, b, c };",
    "",
  ].join("\n");
  const r = runOn({ installer: src });
  assert.equal(r.status, 0, r.stderr);
});

for (const spec of ["lodash", "../validator/x.ts", "../plugin/other.ts"]) {
  test(`installer: import "${spec}" fails`, () => {
    const r = runOn({ installer: `import x from "${spec}";\nexport default x;\n` });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /installer\/x\.ts/);
  });
}

test("installer: require fails", () => {
  const r = runOn({ installer: 'const x = require("node:fs");\nexport default x;\n' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /require.*installer\/x\.ts/);
});

test("installer: missing folder passes", () => {
  const r = runOn({});
  assert.equal(r.status, 0, r.stderr);
});
