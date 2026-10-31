import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { backendRoot, isWindows } from "./helpers.ts";

const helper = join(backendRoot, "installer", "install-helper.ts");
const BASE: [string, string][] = [
  ["org", "acme"],
  ["project", "proj"],
  ["repo", "cfg"],
  ["path", "/kilo.jsonc"],
  ["branch", "main"],
  ["mode", "defaults"],
  ["apiKey", "sk-bf-FrontendTest123"],
];

interface HelperRun {
  status: number | null;
  stdout: string;
  stderr: string;
  config: string;
}

function runHelper(records: [string, string][], seed?: string): HelperRun {
  const home = mkdtempSync(join(tmpdir(), "kilo-fe-"));
  try {
    const configDir = join(home, ".config", "kilo");
    if (seed !== undefined) {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "kilo.jsonc"), seed);
    }
    const env: Record<string, string> = { HOME: home, USERPROFILE: home };
    if (isWindows) env["SYSTEMROOT"] = process.env["SYSTEMROOT"] ?? "C:\Windows";
    const input = records.map(([name, value]) => `${name}=${value}\0`).join("");
    const r = spawnSync(process.execPath, [helper], { input, env, encoding: "utf8" });
    const configPath = join(configDir, "kilo.jsonc");
    return {
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      config: existsSync(configPath) ? readFileSync(configPath, "utf8") : "",
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const withOverride = (name: string, value: string): [string, string][] =>
  BASE.map(([n, v]) => [n, n === name ? value : v] as [string, string]);

test("no frontend record keeps the install.sh messages", () => {
  const r = runHelper(withOverride("org", "a/b"));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^install\.sh: error: invalid value for --org: /);
  assert.match(r.stderr, /Run install\.sh --help for usage\.\n$/);
});

test("frontend=install.ps1 switches prefix, label and usage hint", () => {
  const labels: [string, string][] = [
    ["org", "-Org"],
    ["project", "-Project"],
    ["repo", "-Repo"],
    ["branch", "-Branch"],
    ["mode", "-Mode"],
    ["path", "-Path"],
  ];
  for (const [name, label] of labels) {
    const bad = name === "path" ? "a/../b" : name === "mode" ? "x" : name === "branch" ? "a..b" : "a/b";
    const r = runHelper([...withOverride(name, bad), ["frontend", "install.ps1"]]);
    assert.equal(r.status, 2, name);
    assert.ok(r.stderr.startsWith(`install.ps1: error: invalid value for ${label}: `), r.stderr);
    assert.ok(r.stderr.endsWith("Run install.ps1 -Help for usage.\n"), r.stderr);
    assert.doesNotMatch(r.stderr, /install\.sh/);
  }
});

test("frontend=install.sh behaves like an absent record", () => {
  const a = runHelper(withOverride("org", "a/b"));
  const b = runHelper([...withOverride("org", "a/b"), ["frontend", "install.sh"]]);
  assert.deepEqual(b, a);
});

test("frontend=install.ps1 turns the key warning prefix into install.ps1", () => {
  const r = runHelper([...withOverride("apiKey", "not-a-bf-key"), ["frontend", "install.ps1"]]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^install\.ps1: warning: the Bifrost virtual key does not start with sk-bf-/);
});

test("a bad or duplicate frontend record is bad helper input with the install.sh prefix", () => {
  for (const extra of [
    [["frontend", "bogus"]],
    [["frontend", ""]],
    [["frontend", "install.ps1"], ["frontend", "install.ps1"]],
  ] as [string, string][][]) {
    const r = runHelper([...BASE, ...extra]);
    assert.equal(r.status, 3);
    assert.equal(r.stderr, "install.sh: error: internal error (bad helper input)\n");
    assert.equal(r.config, "");
  }
});

test("file contents do not depend on the frontend record (fresh and update)", () => {
  const seed = '// mine\n{"model":"x","plugin":["other"]}\n';
  for (const start of [undefined, seed]) {
    const withoutRecord = runHelper(BASE, start);
    const withRecord = runHelper([...BASE, ["frontend", "install.ps1"]], start);
    assert.equal(withoutRecord.status, 0, withoutRecord.stderr);
    assert.equal(withRecord.status, 0, withRecord.stderr);
    assert.notEqual(withRecord.config, "");
    assert.equal(withRecord.config, withoutRecord.config);
  }
});
