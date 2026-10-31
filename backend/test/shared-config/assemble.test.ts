import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { snapshot } from "../installer/helpers.ts";
import { assembleTree, backendRoot, isWindows, runAssemble, withTmp } from "./helpers.ts";

const MANIFEST: Array<[string, string]> = [
  ["shared-config/.gitattributes", ".gitattributes"],
  ["shared-config/azure-pipelines.yml", "azure-pipelines.yml"],
  ["shared-config/kilo.jsonc", "kilo.jsonc"],
  ["shared-config/package.json", "package.json"],
  ["shared-config/set-branch-policies.sh", "set-branch-policies.sh"],
  ["validator/validate-kilo-config.ts", "validator/validate-kilo-config.ts"],
  ["validator/kilo-config-rules.ts", "validator/kilo-config-rules.ts"],
  ["validator/kilo-schema-subset.json", "validator/kilo-schema-subset.json"],
  ["plugin/azdo-remote-config.ts", "plugin/azdo-remote-config.ts"],
];

function listFiles(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(root, `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  );
}

test("AC4: assembled tree has exactly the 9 manifest files", () => {
  withTmp((tmp) => {
    const out = assembleTree(tmp);
    assert.deepEqual(listFiles(out).sort(), MANIFEST.map(([, target]) => target).sort());
  });
});

test("AC4: every file is a byte-identical copy of its backend source", () => {
  withTmp((tmp) => {
    const out = assembleTree(tmp);
    for (const [source, target] of MANIFEST) {
      assert.ok(readFileSync(join(backendRoot, source)).equals(readFileSync(join(out, target))), target);
    }
  });
});

test("AC4: package.json is an ES module without dependencies", () => {
  withTmp((tmp) => {
    const pkg = JSON.parse(readFileSync(join(assembleTree(tmp), "package.json"), "utf8"));
    assert.equal(pkg.type, "module");
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
  });
});

test("AC4: success output names the count and never the output path", () => {
  withTmp((tmp) => {
    const out = join(tmp, "c1");
    const r = runAssemble([out]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "assemble-shared-repo: wrote 9 files");
    assert.ok(!r.stdout.includes(out) && !r.stderr.includes(out));
  });
});

test("AC4: an existing empty directory is accepted", () => {
  withTmp((tmp) => {
    const out = join(tmp, "empty");
    mkdirSync(out);
    assert.equal(runAssemble([out]).status, 0);
    assert.equal(listFiles(out).length, 9);
  });
});

test("AC4: set-branch-policies.sh is executable on POSIX", { skip: isWindows }, () => {
  withTmp((tmp) => {
    const mode = statSync(join(assembleTree(tmp), "set-branch-policies.sh")).mode & 0o111;
    assert.notEqual(mode, 0);
  });
});

test("a non-empty output directory is refused and left unchanged", () => {
  withTmp((tmp) => {
    const out = join(tmp, "busy");
    mkdirSync(out);
    writeFileSync(join(out, "keep.txt"), "keep");
    const before = snapshot(out);
    const r = runAssemble([out]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /output directory must be empty or absent/);
    assert.deepEqual(snapshot(out), before);
  });
});

test("an output path that is a file is refused", () => {
  withTmp((tmp) => {
    const out = join(tmp, "afile");
    writeFileSync(out, "x");
    const r = runAssemble([out]);
    assert.equal(r.status, 2);
    assert.equal(readFileSync(out, "utf8"), "x");
  });
});

test("usage errors exit 2 without echoing the argument", () => {
  const cases: string[][] = [[], ["a", "b"], ["--bogus-VALUE_SENTINEL_42"], ["VALUE_SENTINEL_42", "extra"]];
  for (const args of cases) {
    const r = runAssemble(args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /assemble-shared-repo: usage error: /);
    assert.ok(!r.stderr.includes("VALUE_SENTINEL_42") && !r.stderr.includes("--bogus"));
  }
});

test("--help exits 0 with usage on stdout", () => {
  for (const flag of ["--help", "-h"]) {
    const r = runAssemble([flag]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
  }
});
