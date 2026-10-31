import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { findBash } from "../installer/helpers.ts";
import {
  assembleTree,
  expectedArgv,
  forwardSlashes,
  makeBin,
  PAT_SENTINEL,
  policyArgs,
  policyScript,
  readAzRecords,
  runBash,
  sandboxEnv,
  sharedConfigDir,
  shQuote,
  VALID,
  VALUE_SENTINEL,
  withTmp,
  type PolicyInputs,
  type RunResult,
} from "./helpers.ts";

const ORG_URL = "https://dev.azure.com/acme";
const POLICIES = ["approver-count", "required-reviewer", "build"];

interface Ctx {
  tmp: string;
  run: (args: string[], extraEnv?: Record<string, string>, script?: string) => RunResult;
}

function withCtx(opts: { az: boolean }, fn: (ctx: Ctx) => void): void {
  withTmp((tmp) => {
    const bin = makeBin(tmp, { az: opts.az });
    fn({
      tmp,
      run: (args, extraEnv = {}, script = policyScript) =>
        runBash(script, args, tmp, sandboxEnv(tmp, bin, { AZURE_DEVOPS_EXT_PAT: PAT_SENTINEL, ...extraEnv })),
    });
  });
}

function assertNoLeak(r: RunResult, ...values: string[]): void {
  const all = r.stdout + r.stderr;
  for (const value of [PAT_SENTINEL, "AZ_STDOUT_MARKER", "AZ_STDERR_MARKER", ...values]) {
    assert.ok(!all.includes(value), `output leaked ${value}`);
  }
}

test("AC5: --dry-run prints exactly the three az commands and runs nothing", () => {
  withCtx({ az: true }, ({ tmp, run }) => {
    const r = run(policyArgs(VALID, ["--dry-run"]));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    const expected = expectedArgv(VALID, ORG_URL).map((argv) => ["az", ...argv].map(shQuote).join(" "));
    assert.deepEqual(r.stdout.split("\n"), [...expected, ""]);
    assert.equal(readAzRecords(tmp).length, 0);
    assertNoLeak(r);
  });
});

test("AC5: dry run content - thresholds, group, build id and blocking flags", () => {
  withCtx({ az: false }, ({ run }) => {
    const [approver, reviewer, build] = run(policyArgs(VALID, ["--dry-run"])).stdout.trim().split("\n");
    assert.match(approver ?? "", /approver-count create .*--minimum-approver-count 1 --creator-vote-counts false/);
    assert.match(reviewer ?? "", /--required-reviewer-ids 11111111-2222-4333-8444-555555555555 /);
    assert.match(build ?? "", /--build-definition-id 42 .*--valid-duration 0/);
    for (const line of [approver, reviewer, build]) {
      assert.match(line ?? "", /--branch main --branch-match-type exact --enabled true --blocking true/);
      assert.ok((line ?? "").includes(`--repository-id ${VALID.repo}`));
    }
  });
});

test("AC5: organization forms normalise to https://dev.azure.com/<org>", () => {
  withCtx({ az: false }, ({ run }) => {
    for (const org of ["acme", "https://dev.azure.com/acme/", "https://dev.azure.com/acme", "https://acme.visualstudio.com"]) {
      const r = run(policyArgs({ ...VALID, org }, ["--dry-run"]));
      assert.equal(r.status, 0, org);
      assert.equal(r.stdout.split("\n").filter((l) => l.includes(`--org ${ORG_URL} `)).length, 3, org);
    }
  });
});

test("AC5: dry run requires no az on PATH", () => {
  withCtx({ az: false }, ({ run }) => {
    assert.equal(run(policyArgs(VALID, ["--dry-run"])).status, 0);
  });
});

test("AC5: the assembled copy behaves like the source", () => {
  withTmp((tmp) => {
    const copy = join(assembleTree(tmp), "set-branch-policies.sh");
    const bin = makeBin(tmp, { az: true });
    const r = runBash(copy, policyArgs(), tmp, sandboxEnv(tmp, bin, { AZURE_DEVOPS_EXT_PAT: PAT_SENTINEL }));
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readAzRecords(tmp), expectedArgv(VALID, ORG_URL));
  });
});

test("AC6: a real run calls az three times with the exact argv", () => {
  withCtx({ az: true }, ({ tmp, run }) => {
    const r = run(policyArgs());
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readAzRecords(tmp), expectedArgv(VALID, ORG_URL));
    assert.deepEqual(r.stdout.split("\n"), [
      "set-branch-policies: created approver-count policy on main",
      "set-branch-policies: created required-reviewer policy on main",
      "set-branch-policies: created build policy on main",
      "set-branch-policies: done (3 policies created; re-running creates duplicate policies)",
      "",
    ]);
    assertNoLeak(r);
  });
});

const hostile: PolicyInputs[] = [
  { ...VALID, project: "x; printf pwned > p1" },
  { ...VALID, project: "$(printf pwned > p2)" },
  { ...VALID, project: "`printf pwned > p3`" },
  { ...VALID, project: "O'Brien Jr", group: "[O'Brien Jr]\\Reviewers" },
];

test("AC6: hostile values are passed literally and never executed", () => {
  for (const inputs of hostile) {
    withCtx({ az: true }, ({ tmp, run }) => {
      const r = run(policyArgs(inputs));
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(readAzRecords(tmp), expectedArgv(inputs, ORG_URL));
      for (const name of ["p1", "p2", "p3"]) assert.ok(!existsSync(join(tmp, name)), name);
      assertNoLeak(r);
    });
  }
});

test("AC6: dry run quotes hostile values so each line reproduces the argv", () => {
  withCtx({ az: false }, ({ run }) => {
    const inputs = hostile[3] as PolicyInputs;
    const lines = run(policyArgs(inputs, ["--dry-run"])).stdout.trim().split("\n");
    assert.ok((lines[0] ?? "").includes("--project 'O'\\''Brien Jr'"));
    assert.ok((lines[1] ?? "").includes("--required-reviewer-ids '[O'\\''Brien Jr]\\Reviewers'"));
  });
});

POLICIES.forEach((policy, index) => {
  test(`AC6: az failure on ${policy} stops the run with exit 1 and a fixed message`, () => {
    withCtx({ az: true }, ({ tmp, run }) => {
      const r = run(policyArgs(), { FAKE_AZ_FAIL: policy });
      assert.equal(r.status, 1);
      assert.equal(readAzRecords(tmp).length, index + 1);
      assert.equal(
        r.stderr.trim(),
        `set-branch-policies: failed to create the ${policy} policy (az exit 7); later policies were not created. ` +
          "Check az login or AZURE_DEVOPS_EXT_PAT, the ids and your permissions; run with --dry-run to see the commands.",
      );
      assertNoLeak(r);
    });
  });
});

test("AC6: a missing az exits 1 with a clear message", () => {
  withCtx({ az: false }, ({ run }) => {
    const r = run(policyArgs());
    assert.equal(r.status, 1);
    assert.match(r.stderr, /az was not found on PATH/);
  });
});

test("AC7: each required flag missing is a usage error", () => {
  withCtx({ az: true }, ({ tmp, run }) => {
    const all = policyArgs();
    for (let i = 0; i < all.length; i += 2) {
      const args = all.filter((_, j) => j !== i && j !== i + 1);
      const r = run(args);
      assert.equal(r.status, 2, all[i]);
      assert.match(r.stderr, new RegExp(`missing required option ${all[i]}`));
      assert.match(r.stderr, /Usage:/);
    }
    assert.equal(readAzRecords(tmp).length, 0);
  });
});

test("AC7: empty, dash-leading and valueless flags are rejected", () => {
  withCtx({ az: true }, ({ tmp, run }) => {
    const all = policyArgs();
    for (let i = 0; i < all.length; i += 2) {
      for (const bad of ["", "-x"]) {
        const args = [...all];
        args[i + 1] = bad;
        const r = run(args);
        assert.equal(r.status, 2, `${all[i]} ${bad}`);
        assert.match(r.stderr, new RegExp(`${all[i]} requires a value`));
      }
      assert.equal(run(all.slice(0, i + 1)).status, 2);
    }
    assert.equal(readAzRecords(tmp).length, 0);
  });
});

test("AC7: a duplicate flag is rejected", () => {
  withCtx({ az: true }, ({ tmp, run }) => {
    const r = run([...policyArgs(), "--project", "other"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--project given more than once/);
    assert.equal(readAzRecords(tmp).length, 0);
  });
});

const rejected: Array<[string, string[]]> = [
  ["--pat option", ["--pat", VALUE_SENTINEL]],
  ["--token= option", [`--token=${VALUE_SENTINEL}`]],
  ["--org=value form", [`--org=${VALUE_SENTINEL}`]],
  ["positional argument", [VALUE_SENTINEL]],
];

for (const [label, extra] of rejected) {
  test(`AC7: ${label} is rejected without echoing it`, () => {
    withCtx({ az: true }, ({ tmp, run }) => {
      const r = run([...policyArgs(), ...extra]);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /usage error: /);
      assertNoLeak(r, VALUE_SENTINEL);
      assert.equal(readAzRecords(tmp).length, 0);
    });
  });
}

const invalidInputs: Array<[string, Partial<PolicyInputs>]> = [
  ["http org url", { org: "http://dev.azure.com/acme" }],
  ["foreign org host", { org: "https://evil.example.com/acme" }],
  ["org with path", { org: "https://dev.azure.com/acme/extra" }],
  ["non-GUID repository", { repo: "my-repo" }],
  ["build id 0", { build: "0" }],
  ["build id 12a", { build: "12a" }],
  ["group with semicolon", { group: "a;b" }],
  ["control character in project", { project: "bad\u0007name" }],
  ["newline in group", { group: "a\nb c" }],
  ["over-long project", { project: "p".repeat(257) }],
];

for (const [label, patch] of invalidInputs) {
  test(`AC7: invalid input (${label}) exits 2 and never invokes az`, () => {
    withCtx({ az: true }, ({ tmp, run }) => {
      const r = run(policyArgs({ ...VALID, ...patch }));
      assert.equal(r.status, 2);
      assert.match(r.stderr, /usage error: invalid value for /);
      assert.match(r.stderr, /Usage:/);
      for (const value of Object.values(patch)) assert.ok(!r.stderr.includes(value) && !r.stdout.includes(value));
      assert.equal(readAzRecords(tmp).length, 0);
    });
  });
}

test("AC7: --help and -h print usage and exit 0", () => {
  withCtx({ az: true }, ({ tmp, run }) => {
    for (const flag of ["--help", "-h"]) {
      const r = run([flag, "--bogus"]);
      assert.equal(r.status, 0);
      assert.match(r.stdout, /Usage:/);
      assert.match(r.stdout, /az repos show --repository <name> --query id -o tsv/);
      assert.match(r.stdout, /AZURE_DEVOPS_EXT_PAT/);
      assert.match(r.stdout, /duplicate policies/);
      assert.ok(!r.stdout.includes(PAT_SENTINEL));
    }
    assert.equal(readAzRecords(tmp).length, 0);
  });
});

test("static: script has no CR, parses, and uses no dynamic execution or secret expansion", () => {
  const text = readFileSync(policyScript, "utf8");
  assert.ok(!text.includes("\r"));
  assert.ok(text.startsWith("#!/usr/bin/env bash\n"));
  assert.doesNotMatch(text, /\beval\b/);
  assert.doesNotMatch(text, /\b(sh|bash) -c\b/);
  assert.doesNotMatch(text, /^\s*(source|\.)\s/m);
  assert.doesNotMatch(text, /\$\{?AZURE_DEVOPS_EXT_PAT/);
  const syntax = spawnSync(findBash(), ["-n", forwardSlashes(policyScript)], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("every shared-config template file is LF-only", () => {
  for (const name of readdirSync(sharedConfigDir)) {
    assert.ok(!readFileSync(join(sharedConfigDir, name)).includes(13), `${name} contains CR`);
  }
});
