import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { FAKE_SECRET, SECRET_TAIL, SENTINEL, noStack, runCli, runOn, withFiles } from "./helpers.ts";

function expectFail(r: ReturnType<typeof runOn>, pattern: RegExp): void {
  assert.equal(r.status, 1, r.all);
  assert.match(r.stdout, pattern);
  assert.ok(noStack(r), r.all);
  assert.ok(!r.all.includes(SENTINEL));
  assert.ok(!r.all.includes(SECRET_TAIL));
}

test("AC2: apiKey anywhere is an error", () => {
  const cases: [string, string][] = [
    [`{"apiKey": "${SENTINEL}"}`, "apiKey"],
    [`{"provider": {"bifrost": {"options": {"apiKey": "${SENTINEL}"}}}}`, "provider\\.bifrost\\.options\\.apiKey"],
    [`{"list": [{"apiKey": "${SENTINEL}"}]}`, "list\\[0\\]\\.apiKey"],
    [`{"APIKEY": "${SENTINEL}"}`, "APIKEY"],
  ];
  for (const [json, path] of cases) expectFail(runOn(json), new RegExp(`api-key at ${path}:`));
});

test("AC3: sk-bf- secrets are caught in values, arrays and comments", () => {
  expectFail(runOn(`{"a": {"b": "${FAKE_SECRET}"}}`), /secret-pattern at a\.b:/);
  expectFail(runOn(`{"a": "prefix ${FAKE_SECRET} suffix"}`), /secret-pattern at a:/);
  expectFail(runOn(`{"a": ["${FAKE_SECRET}"]}`), /secret-pattern at a\[0\]:/);
  expectFail(runOn(`{}\n// ${FAKE_SECRET}\n`), /secret-pattern at line 2:/);
  expectFail(runOn(`{}\n/* x\n ${FAKE_SECRET} */\n`), /secret-pattern at line 3:/);
  expectFail(runOn(`{"${FAKE_SECRET}": 1}`), /secret-pattern at \[<redacted>\]:/);
});

test("AC4: malformed input fails with names, rules and no stack", () => {
  const cases: [string, RegExp][] = [
    ['{"a": "x', /invalid-jsonc/],
    ["{} /* open", /invalid-jsonc/],
    ["{a: 1}", /invalid-jsonc/],
    ["[]", /root-not-object/],
    ['"s"', /root-not-object/],
    ["5", /root-not-object/],
    ["null", /root-not-object/],
  ];
  for (const [text, rule] of cases) {
    const r = runOn(text);
    expectFail(r, rule);
    assert.match(r.stdout, /c\.jsonc: invalid/);
  }
});

test("AC4: usage and I/O errors exit 2", () => {
  const none = runCli([]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /usage/);
  const missing = runCli([join("nowhere", "missing.jsonc")]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /io-error: cannot read file \(ENOENT\)/);
  assert.ok(noStack(missing));
  assert.equal(runCli(["--bogus", "x"]).status, 2);
  assert.equal(runCli(["--allowed-hosts"]).status, 2);
  assert.equal(runCli(["--allowed-hosts", "bad host", "x"]).status, 2);
  assert.equal(runCli(["--allowed-hosts=", "x"]).status, 2);
  assert.equal(runCli(["--help"]).status, 0);
  assert.match(runCli(["-h"]).stdout, /usage/);
});

test("AC4: a directory is not a regular file", () => {
  withFiles({}, (dir) => {
    const r = runCli([dir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not a regular file/);
  });
});

test("AC4: oversized and non-UTF-8 files are validation errors", () => {
  expectFail(runOn(Buffer.alloc(1048577, 0x20)), /file-too-large/);
  expectFail(runOn(Buffer.from([0x7b, 0xff, 0x7d])), /invalid-encoding/);
});

test("AC6: unresolvable {file:} placeholders warn once each", () => {
  for (const p of ["rel/x", "~", "~user/x", "//host/share/x", "\\\\\\\\host\\\\s"]) {
    const r = runOn(`{"a": "{file:${p}}"}`);
    assert.equal(r.status, 0, r.all);
    assert.equal(r.stdout.match(/file-placeholder-unresolvable at a:/g)?.length, 1, `${p}: ${r.all}`);
    assert.ok(!r.all.includes("host"));
  }
});

test("AC6: resolvable placeholder forms do not warn", () => {
  for (const p of ["file:~/x", "file:/abs/x", "env:VAR"]) {
    const r = runOn(`{"a": "{${p}}"}`);
    assert.equal(r.status, 0, r.all);
    assert.doesNotMatch(r.stdout, /warning/);
  }
});

test("AC7: prototype keys are errors, prototype member names are warnings", () => {
  for (const key of ["__proto__", "constructor", "prototype"]) {
    expectFail(runOn(`{"x": {"y": {"${key}": 1}}}`), new RegExp(`prototype-key at x\\.y\\.${key}:`));
  }
  for (const key of ["hasOwnProperty", "toString"]) {
    const r = runOn(`{"x": {"${key}": 1}}`);
    assert.equal(r.status, 0, r.all);
    assert.match(r.stdout, new RegExp(`warning prototype-member-name at x\\.${key}:`));
  }
});

test("AC7: top-level plugin warns", () => {
  const r = runOn('{"plugin": ["x"]}');
  assert.equal(r.status, 0, r.all);
  assert.match(r.stdout, /warning plugin-ignored at plugin:/);
});

test("AC7: --allowed-hosts checks baseURL", () => {
  const host = ["--allowed-hosts", "bifrost.yourcompany.internal"];
  const mk = (v: string) => `{"provider": {"p": {"options": {"baseURL": ${v}}}}}`;
  const bad = [
    '"http://bifrost.yourcompany.internal/v1"',
    '"not a url"',
    '"https://evil.example.com/v1"',
    '"https://user:pw@bifrost.yourcompany.internal/v1"',
    "5",
  ];
  for (const v of bad) {
    const r = runOn(mk(v), host);
    assert.equal(r.status, 1, r.all);
    assert.match(r.stdout, /base-url-host at provider\.p\.options\.baseURL:/);
    assert.ok(!r.all.includes("pw@"));
    assert.doesNotMatch(runOn(mk(v)).stdout, /base-url-host/);
  }
  const ok = runOn(mk('"https://Bifrost.YourCompany.internal/v1"'), host);
  assert.equal(ok.status, 0, ok.all);
  assert.equal(runOn(mk('"https://x.io"'), ["--allowed-hosts=x.io"]).status, 0);
});

test("AC8: multiple files are all reported", () => {
  withFiles({ "good.jsonc": "{}", "bad.jsonc": "[]" }, (dir) => {
    const bad = join(dir, "bad.jsonc");
    const r = runCli([join(dir, "good.jsonc"), bad]);
    assert.equal(r.status, 1, r.all);
    assert.match(r.stdout, /good\.jsonc: valid\n/);
    assert.match(r.stdout, /bad\.jsonc: invalid/);
    assert.match(r.stdout, /2 files checked: 1 valid, 1 invalid, 0 unreadable/);
    const m = runCli([join(dir, "nope.jsonc"), bad]);
    assert.equal(m.status, 2, m.all);
    assert.match(m.stderr, /nope\.jsonc: io-error/);
    assert.match(m.stdout, /bad\.jsonc: invalid/);
  });
});

test("AC8: `--` makes dash-prefixed names files", () => {
  const r = runCli(["--", "-weird.jsonc"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /-weird\.jsonc: io-error/);
});

test("output caps findings at 200 with a note", () => {
  const keys = Array.from({ length: 250 }, (_, i) => `"k${i}": "{file:r}"`).join(",");
  const r = runOn(`{${keys}}`);
  assert.equal(r.status, 0, r.all);
  assert.equal(r.stdout.match(/file-placeholder-unresolvable/g)?.length, 200);
  assert.match(r.stdout, /note: 50 more findings not shown/);
});

test("file names with control characters are sanitised", () => {
  const r = runCli(["bad\u001b[31mname.jsonc"]);
  assert.equal(r.status, 2);
  assert.ok(!r.stderr.includes("\u001b"));
});
