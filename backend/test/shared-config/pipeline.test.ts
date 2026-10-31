import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  assembleTree,
  defaultAllowedHosts,
  extractPipelineScript,
  makeBin,
  runBash,
  sandboxEnv,
  sharedConfigDir,
  withTmp,
  yamlScriptLines,
  type RunResult,
} from "./helpers.ts";

const yaml = readFileSync(join(sharedConfigDir, "azure-pipelines.yml"), "utf8");
const exampleConfig = readFileSync(join(sharedConfigDir, "kilo.jsonc"), "utf8");
const FAKE_SECRET = "sk-" + "bf-" + "AbCdEf1234567890";
const NAME_LINE = '"name": "Bifrost",';

function countMatches(text: string, re: RegExp): number {
  return text.split("\n").filter((line) => re.test(line)).length;
}

test("AC1: triggers - trigger none and a pr block including main", () => {
  assert.equal(countMatches(yaml, /^trigger: none$/), 1);
  assert.match(yaml, /^pr:\n {2}branches:\n {4}include:\n {6}- main$/m);
});

test("AC1: Node 22.x via UseNode@1 with an in-step 22.18 guard", () => {
  assert.equal(countMatches(yaml, /task: UseNode@1/), 1);
  assert.match(yaml, /inputs:\n {6}version: "22\.x"/);
  const script = extractPipelineScript(yaml);
  assert.match(script, /process\.versions\.node/);
  assert.match(script, /a < 22 \|\| \(a === 22 && b < 18\)/);
});

test("AC1: no package manager is ever invoked", () => {
  assert.doesNotMatch(yaml, /npm install|npm ci|npm i |npx|yarn|pnpm/);
});

test("AC1: one bash step runs the validator over kilo.jsonc and teams/*/kilo.jsonc", () => {
  assert.equal(countMatches(yaml, /^ {2}- bash: \|$/), 1);
  const script = extractPipelineScript(yaml);
  for (const needle of ["validate-kilo-config.ts", "--allowed-hosts", "kilo.jsonc", "teams/*/kilo.jsonc"]) {
    assert.ok(script.includes(needle), needle);
  }
  assert.ok(!script.includes("$("));
  assert.ok(yamlScriptLines(yaml).length >= 5);
});

test("AC1: the allowed hosts variable is passed through env and has a default", () => {
  assert.match(yaml, /^ {4}env:\n {6}KILO_ALLOWED_HOSTS: \$\(KILO_ALLOWED_HOSTS\)$/m);
  assert.equal(defaultAllowedHosts(yaml), "bifrost.yourcompany.internal");
});

test("AC1: yaml has no CR and no tab", () => {
  assert.ok(!yaml.includes("\r"));
  assert.ok(!yaml.includes("\t"));
});

interface Gate {
  tree: string;
  run: (hosts?: string) => RunResult;
}

function withGate(fn: (gate: Gate) => void): void {
  withTmp((tmp) => {
    const tree = assembleTree(tmp);
    const bin = makeBin(tmp, { node: true });
    const step = join(tmp, "step.sh");
    writeFileSync(step, extractPipelineScript(yaml));
    fn({
      tree,
      run: (hosts = defaultAllowedHosts(yaml)) =>
        runBash(step, [], tree, sandboxEnv(tmp, bin, { KILO_ALLOWED_HOSTS: hosts })),
    });
  });
}

function writeTeam(tree: string, team: string, content: string): void {
  mkdirSync(join(tree, "teams", team), { recursive: true });
  writeFileSync(join(tree, "teams", team, "kilo.jsonc"), content);
}

test("AC2: root config only (no teams directory) passes", () => {
  withGate((gate) => {
    const r = gate.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /kilo\.jsonc: valid/);
  });
});

test("AC2: an empty teams directory passes", () => {
  withGate((gate) => {
    mkdirSync(join(gate.tree, "teams"));
    assert.equal(gate.run().status, 0);
  });
});

test("AC2: root and team files are both validated", () => {
  withGate((gate) => {
    writeTeam(gate.tree, "payments", exampleConfig);
    const r = gate.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^kilo\.jsonc: valid$/m);
    assert.match(r.stdout, /^teams\/payments\/kilo\.jsonc: valid$/m);
  });
});

test("AC2: an invalid team file fails the gate", () => {
  withGate((gate) => {
    writeTeam(gate.tree, "payments", "{ not json");
    assert.notEqual(gate.run().status, 0);
  });
});

const mutations: Array<[string, (text: string) => string, string[]]> = [
  ["apiKey literal", (t) => t.replace(NAME_LINE, `${NAME_LINE} "apiKey": "VALUE_SENTINEL_42",`), ["VALUE_SENTINEL_42"]],
  ["secret-shaped value", (t) => t.replace(NAME_LINE, `${NAME_LINE} "note": "${FAKE_SECRET}",`), ["AbCdEf1234567890"]],
  ["host not on the allow-list", (t) => t.replace("bifrost.yourcompany.internal", "evil.example.com"), []],
];

for (const [label, mutate, forbidden] of mutations) {
  for (const place of ["kilo.jsonc", "teams/x/kilo.jsonc"]) {
    test(`AC3: ${label} in ${place} fails the gate without leaking the value`, () => {
      withGate((gate) => {
        const mutated = mutate(exampleConfig);
        assert.notEqual(mutated, exampleConfig);
        if (place === "kilo.jsonc") writeFileSync(join(gate.tree, place), mutated);
        else writeTeam(gate.tree, "x", mutated);
        const r = gate.run();
        assert.notEqual(r.status, 0);
        for (const value of forbidden) assert.ok(!(r.stdout + r.stderr).includes(value), value);
      });
    });
  }
}

test("AC3: an empty allowed-hosts list fails closed", () => {
  withGate((gate) => {
    assert.notEqual(gate.run("").status, 0);
  });
});
