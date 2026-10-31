import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { backendRoot } from "./helpers.ts";

const bytes = readFileSync(join(backendRoot, "installer", "install.ps1"));
const text = bytes.toString("latin1");
const contract = readFileSync(join(backendRoot, "..", "docs", "architecture", "contracts", "installer-cli.md"), "utf8").replaceAll(
  "\r\n",
  "\n",
);

test("AC-8 install.ps1 is ASCII only with LF endings and no BOM", () => {
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const bad = [...bytes].filter((b) => b !== 0x0a && (b < 0x20 || b > 0x7e));
  assert.deepEqual(bad, []);
  assert.equal(bytes[bytes.length - 1], 0x0a);
});

test("AC-8 install.ps1 has no param block, no iex, no web, no file-writing or ACL commands", () => {
  const banned = [
    String.raw`param\s*\(`,
    String.raw`\[CmdletBinding`,
    String.raw`\$IsWindows`,
    String.raw`Invoke-Expression`,
    String.raw`\biex\b`,
    String.raw`Invoke-WebRequest`,
    String.raw`Invoke-RestMethod`,
    String.raw`\birm\b`,
    String.raw`\biwr\b`,
    String.raw`Start-Process`,
    String.raw`Set-Content`,
    String.raw`Add-Content`,
    String.raw`Out-File`,
    String.raw`New-Item`,
    String.raw`Remove-Item`,
    String.raw`Copy-Item`,
    String.raw`Set-Acl`,
    String.raw`icacls`,
    String.raw`Write-Host`,
    String.raw`Write-Error`,
  ];
  for (const pattern of banned) assert.doesNotMatch(text, new RegExp(pattern, "i"), pattern);
});

test("AC-8 install.ps1 contains no test seams", () => {
  assert.ok(!text.includes("KILO_TEST_"));
  assert.ok(!text.includes("NODE_OPTIONS"));
});

test("AC-8 install.ps1 sets strict mode and stop-on-error and routes failures to exit 3", () => {
  assert.match(text, /^Set-StrictMode -Version 2\.0$/m);
  assert.match(text, /^\$ErrorActionPreference = 'Stop'$/m);
  assert.match(text, /install\.ps1: error: internal error\.'\)\n {2}exit 3\n\}/);
});

test("AC-8 the contract documents install.ps1 in section 10", () => {
  const start = contract.indexOf("## 10. `install.ps1`");
  assert.notEqual(start, -1);
  const section = contract.slice(start);
  for (const needle of ["install.ps1", "-Org", "-NoSmoke", "KILO_BIFROST_KEY"]) {
    assert.ok(section.includes(needle), `section 10 lacks ${needle}`);
  }
  assert.match(section, /Exit codes: 0 ok, 1 prerequisite, 2 usage, 3 file system, 4 installed but smoke test failed\./);
});
