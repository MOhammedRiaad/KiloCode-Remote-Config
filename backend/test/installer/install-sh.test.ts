import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { __internals } from "../../plugin/azdo-remote-config.ts";
import {
  azLogExists,
  backups,
  backendRoot,
  findBash,
  installShPath,
  isWindows,
  REQUIRED_ARGS,
  runInstall,
  snapshot,
  stubAz,
  stubNode,
  withSandbox,
} from "./helpers.ts";
import type { RunResult, Sandbox } from "./helpers.ts";

const FAKE_SECRET = "FAKE_SECRET_SECRET_TAIL";
const PAT = "SENTINEL_PAT_VALUE";
const pluginSource = readFileSync(join(backendRoot, "plugin", "azdo-remote-config.ts"));
const parse = (path: string) => __internals.parseJsonc(readFileSync(path, "utf8")) as Record<string, any>;
const withPat = { AZDO_PAT: PAT };

function noStack(r: RunResult) {
  assert.doesNotMatch(r.stdout + r.stderr, /\n\s+at /);
}

function seed(sb: Sandbox, text: string, dir = sb.configDir): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "kilo.jsonc");
  writeFileSync(path, text);
  return path;
}

const EXISTING = `// my comment\n{\n  "model": "bifrost/x", // inline\n  "plugin": [\n    "my-other-plugin",\n    ["./plugin/azdo-remote-config.ts", {"org": "old", "pat": "OLD_PAT_VALUE",},],\n  ],\n  "provider": {"bifrost": {"options": {"apiKey": "sk-bf-existing"}}},\n}\n`;

function skipOnWindows(t: TestContext): boolean {
  if (isWindows) t.skip("POSIX permissions are not enforced on Windows");
  return isWindows;
}

test("AC-1 fresh install copies the plugin and writes the personal config", (t) => {
  withSandbox((sb) => {
    const r = runInstall(sb, REQUIRED_ARGS, { ...withPat, KILO_BIFROST_KEY: FAKE_SECRET });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readFileSync(join(sb.configDir, "azdo", "azdo-remote-config.ts")), pluginSource);
    const config = parse(join(sb.configDir, "kilo.jsonc"));
    assert.deepEqual(config["plugin"], [
      ["./azdo/azdo-remote-config.ts", { org: "acme", project: "proj", repo: "cfg", path: "/kilo.jsonc", branch: "main", mode: "defaults" }],
    ]);
    assert.equal(config["provider"].bifrost.options.apiKey, FAKE_SECRET);
    if (!skipOnWindows(t)) assert.equal(statSync(join(sb.configDir, "kilo.jsonc")).mode & 0o777, 0o600);
  });
});

test("AC-1 flags beat environment, environment fills the rest", () => {
  withSandbox((sb) => {
    const env = { ...withPat, KILO_AZDO_ORG: "envorg", KILO_AZDO_PROJECT: "envproj", KILO_AZDO_REPO: "envrepo", KILO_AZDO_BRANCH: "dev" };
    const r = runInstall(sb, ["--org", "flagorg", "--mode", "enforce"], env);
    assert.equal(r.status, 0, r.stderr);
    const options = parse(join(sb.configDir, "kilo.jsonc"))["plugin"][0][1];
    assert.deepEqual(options, { org: "flagorg", project: "envproj", repo: "envrepo", path: "/kilo.jsonc", branch: "dev", mode: "enforce" });
  });
});

test("AC-1 XDG_CONFIG_HOME selects the target directory", () => {
  withSandbox((sb) => {
    const r = runInstall(sb, REQUIRED_ARGS, { ...withPat, XDG_CONFIG_HOME: sb.xdg });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(statSync(join(sb.xdg, "kilo", "kilo.jsonc")).isFile());
    assert.ok(statSync(join(sb.xdg, "kilo", "azdo", "azdo-remote-config.ts")).isFile());
    assert.deepEqual(readdirSync(sb.home), []);
  });
});

test("AC-1 --help prints usage without checks or writes", () => {
  withSandbox((sb) => {
    const r = runInstall(sb, ["--org", "x", "--help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage: install\.sh/);
    assert.deepEqual(snapshot(sb.home), {});
  });
});

test("AC-2 neither the key nor the PAT is ever printed", () => {
  withSandbox((sb) => {
    const r = runInstall(sb, REQUIRED_ARGS, { ...withPat, KILO_BIFROST_KEY: FAKE_SECRET });
    for (const text of [r.stdout, r.stderr]) {
      for (const secret of [FAKE_SECRET, PAT, "SECRET_TAIL"]) assert.ok(!text.includes(secret));
    }
    assert.ok(!readFileSync(join(sb.configDir, "kilo.jsonc"), "utf8").includes(PAT));
  });
});

test("AC-2 without a key the placeholder is written and the user is told", () => {
  withSandbox((sb) => {
    const r = runInstall(sb, REQUIRED_ARGS, withPat);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(parse(join(sb.configDir, "kilo.jsonc"))["provider"].bifrost.options.apiKey, "sk-bf-<your-virtual-key>");
    assert.match(r.stdout, /virtual key/i);
    assert.match(r.stdout, /KILO_BIFROST_KEY/);
  });
});

test("AC-2 a key flag does not exist and its value is not echoed", () => {
  withSandbox((sb) => {
    const r = runInstall(sb, [...REQUIRED_ARGS, "--key", FAKE_SECRET], withPat);
    assert.equal(r.status, 2);
    assert.ok(!(r.stdout + r.stderr).includes(FAKE_SECRET));
    assert.deepEqual(snapshot(sb.home), {});
  });
});

test("AC-2 a key with control characters is rejected without echo", () => {
  withSandbox((sb) => {
    const r = runInstall(sb, REQUIRED_ARGS, { ...withPat, KILO_BIFROST_KEY: `${FAKE_SECRET}\tx` });
    assert.equal(r.status, 2);
    assert.ok(!(r.stdout + r.stderr).includes(FAKE_SECRET));
    assert.deepEqual(snapshot(sb.home), {});
  });
});

test("AC-3 update keeps other settings, replaces the key, backs up byte-identically", () => {
  withSandbox((sb) => {
    seed(sb, EXISTING);
    const r = runInstall(sb, REQUIRED_ARGS, { ...withPat, KILO_BIFROST_KEY: FAKE_SECRET });
    assert.equal(r.status, 0, r.stderr);
    const config = parse(join(sb.configDir, "kilo.jsonc"));
    assert.equal(config["model"], "bifrost/x");
    assert.equal(config["plugin"][0], "my-other-plugin");
    assert.equal(config["plugin"].length, 2);
    assert.equal(config["plugin"][1][1].org, "acme");
    assert.equal(config["provider"].bifrost.options.apiKey, FAKE_SECRET);
    const found = backups(sb.configDir);
    assert.equal(found.length, 1);
    assert.equal(readFileSync(join(sb.configDir, found[0] as string), "utf8"), EXISTING);
    assert.match(r.stdout, /dropped plugin options.*pat/);
    assert.ok(!(r.stdout + r.stderr).includes("OLD_PAT_VALUE"));
    assert.ok(!readFileSync(join(sb.configDir, "kilo.jsonc"), "utf8").includes("OLD_PAT_VALUE"));
  });
});

test("AC-3 update without a key keeps the existing key", (t) => {
  withSandbox((sb) => {
    seed(sb, EXISTING);
    const r = runInstall(sb, REQUIRED_ARGS, withPat);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(parse(join(sb.configDir, "kilo.jsonc"))["provider"].bifrost.options.apiKey, "sk-bf-existing");
    assert.doesNotMatch(r.stdout, /Set your Bifrost virtual key/);
    if (!skipOnWindows(t)) assert.equal(statSync(join(sb.configDir, "kilo.jsonc")).mode & 0o777, 0o600);
    if (!isWindows) assert.equal(statSync(join(sb.configDir, backups(sb.configDir)[0] as string)).mode & 0o777, 0o600);
  });
});

test("AC-4 nothing is written to plugin/ or plugins/ and the entry appears once", () => {
  withSandbox((sb) => {
    for (const start of ["fresh", "update"]) {
      if (start === "update") seed(sb, EXISTING);
      const r = runInstall(sb, REQUIRED_ARGS, withPat);
      assert.equal(r.status, 0, r.stderr);
      const raw = readFileSync(join(sb.configDir, "kilo.jsonc"), "utf8");
      assert.equal(raw.split("azdo-remote-config.ts").length - 1, 1);
      assert.deepEqual(readdirSync(sb.configDir).filter((n) => n === "plugin" || n === "plugins"), []);
    }
  });
});

test("AC-4 an existing copy in plugin/ triggers a warning and stays untouched", () => {
  withSandbox((sb) => {
    mkdirSync(join(sb.configDir, "plugin"), { recursive: true });
    const old = join(sb.configDir, "plugin", "azdo-remote-config.ts");
    writeFileSync(old, "old copy");
    const r = runInstall(sb, REQUIRED_ARGS, withPat);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /auto-loaded by Kilo/);
    assert.equal(readFileSync(old, "utf8"), "old copy");
  });
});

test("AC-5 no az and no PAT: exit 1 with a fix, nothing written", () => {
  withSandbox((sb) => {
    const r = runInstall(sb, REQUIRED_ARGS);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /az login/);
    assert.match(r.stderr, /AZDO_PAT/);
    assert.deepEqual(snapshot(sb.home), {});
  });
});

test("AC-5 az present but not logged in: exit 1, nothing written", () => {
  withSandbox((sb) => {
    stubAz(sb, "fail");
    const r = runInstall(sb, REQUIRED_ARGS);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /az login/);
    assert.match(r.stderr, /AZDO_PAT/);
    assert.deepEqual(snapshot(sb.home), {});
  });
});

test("AC-5 logged-in az satisfies the credential check", () => {
  withSandbox((sb) => {
    stubAz(sb, "ok");
    const r = runInstall(sb, REQUIRED_ARGS);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(azLogExists(sb));
  });
});

test("AC-5 a PAT variable skips az entirely", () => {
  withSandbox((sb) => {
    stubAz(sb, "fail");
    const r = runInstall(sb, REQUIRED_ARGS, { AZURE_DEVOPS_EXT_PAT: PAT });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(azLogExists(sb), false);
  });
});

test("AC-5 Node that is too old: exit 1, nothing written", () => {
  withSandbox((sb) => {
    stubNode(sb, "20.11.0");
    const r = runInstall(sb, REQUIRED_ARGS, withPat);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Node\.js 22\.18/);
    assert.match(r.stderr, /20\.11\.0/);
    assert.deepEqual(snapshot(sb.home), {});
  });
});

test("AC-5 every failing prerequisite is reported", () => {
  withSandbox((sb) => {
    stubNode(sb, "18.0.0");
    const r = runInstall(sb, REQUIRED_ARGS);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Node\.js 22\.18/);
    assert.match(r.stderr, /AZDO_PAT/);
  });
});

test("AC-5 Node 22.18 and newer pass the version check", () => {
  for (const version of ["22.18.0", "23.0.1"]) {
    withSandbox((sb) => {
      stubNode(sb, version);
      const r = runInstall(sb, ["--help"]);
      assert.equal(r.status, 0);
    });
  }
});

test("AC-6 running twice changes nothing (fresh start)", () => {
  withSandbox((sb) => {
    const env = { ...withPat, KILO_BIFROST_KEY: FAKE_SECRET };
    assert.equal(runInstall(sb, REQUIRED_ARGS, env).status, 0);
    const before = snapshot(sb.configDir);
    const second = runInstall(sb, REQUIRED_ARGS, env);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(snapshot(sb.configDir), before);
    assert.equal(backups(sb.configDir).length, 0);
    assert.match(second.stdout, /already up to date/);
  });
});

test("AC-6 running twice changes nothing (update start)", () => {
  withSandbox((sb) => {
    seed(sb, EXISTING);
    assert.equal(runInstall(sb, REQUIRED_ARGS, withPat).status, 0);
    const before = snapshot(sb.configDir);
    const count = backups(sb.configDir).length;
    const second = runInstall(sb, REQUIRED_ARGS, withPat);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(snapshot(sb.configDir), before);
    assert.equal(backups(sb.configDir).length, count);
  });
});

test("AC-6 a changed plugin copy is refreshed", () => {
  withSandbox((sb) => {
    assert.equal(runInstall(sb, REQUIRED_ARGS, withPat).status, 0);
    const dest = join(sb.configDir, "azdo", "azdo-remote-config.ts");
    writeFileSync(dest, "stale");
    assert.equal(runInstall(sb, REQUIRED_ARGS, withPat).status, 0);
    assert.deepEqual(readFileSync(dest), pluginSource);
  });
});

for (const missing of ["org", "project", "repo"]) {
  test(`AC-7 missing --${missing} gives exit 2 naming the input`, () => {
    withSandbox((sb) => {
      const args: string[] = [];
      for (const name of ["org", "project", "repo"]) if (name !== missing) args.push(`--${name}`, "v");
      const r = runInstall(sb, args, withPat);
      assert.equal(r.status, 2);
      assert.match(r.stderr, new RegExp(`--${missing} \\(or KILO_AZDO_${missing.toUpperCase()}\\)`));
      assert.deepEqual(snapshot(sb.home), {});
    });
  });
}

test("AC-7 unknown flags, positional arguments and flags without value give exit 2", () => {
  withSandbox((sb) => {
    for (const extra of [["--bogus-ARGTEXT"], ["positional-ARGTEXT"], ["--org"], ["--branch=x-ARGTEXT"]]) {
      const r = runInstall(sb, [...REQUIRED_ARGS, ...extra], withPat);
      assert.equal(r.status, 2);
      assert.doesNotMatch(r.stdout + r.stderr, /ARGTEXT/);
      assert.match(r.stderr, /Run install\.sh --help/);
    }
    assert.deepEqual(snapshot(sb.home), {});
  });
});

test("AC-7 invalid values are rejected before any write", () => {
  withSandbox((sb) => {
    for (const [flag, value] of [["--org", "a/b"], ["--branch", "a..b"], ["--mode", "x"], ["--path", "a/../b"]]) {
      const args = [...REQUIRED_ARGS, flag as string, value as string];
      const r = runInstall(sb, args, withPat);
      assert.equal(r.status, 2, `${flag}`);
      assert.match(r.stderr, new RegExp(`${flag}`));
      noStack(r);
    }
    assert.deepEqual(snapshot(sb.home), {});
  });
});

test("AC-7 problem configs are refused without changes or echo", () => {
  const cases: Array<[string, string]> = [
    ["invalid JSONC", '{ "secretish": CONTENT_SENTINEL '],
    ["array root", '["CONTENT_SENTINEL"]'],
    ["plugin object", '{"plugin": {"x": "CONTENT_SENTINEL"}}'],
    ["provider array", '{"provider": ["CONTENT_SENTINEL"]}'],
  ];
  for (const [label, text] of cases) {
    withSandbox((sb) => {
      seed(sb, text);
      const before = snapshot(sb.home);
      const r = runInstall(sb, REQUIRED_ARGS, withPat);
      assert.equal(r.status, 3, label);
      assert.doesNotMatch(r.stdout + r.stderr, /CONTENT_SENTINEL/);
      noStack(r);
      assert.deepEqual(snapshot(sb.home), before, label);
    });
  }
});

test("AC-7 oversized config is refused", () => {
  withSandbox((sb) => {
    seed(sb, `{"x": "${"a".repeat(1024 * 1024 + 10)}"}`);
    const before = snapshot(sb.home);
    const r = runInstall(sb, REQUIRED_ARGS, withPat);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /1 MiB/);
    assert.deepEqual(snapshot(sb.home), before);
  });
});

test("AC-7 relative XDG_CONFIG_HOME is a usage error", () => {
  withSandbox((sb) => {
    const r = runInstall(sb, REQUIRED_ARGS, { ...withPat, XDG_CONFIG_HOME: "relative/dir" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /XDG_CONFIG_HOME/);
    assert.deepEqual(snapshot(sb.home), {});
  });
});

test("AC-7 a symlinked kilo.jsonc is refused", (t) => {
  if (skipOnWindows(t)) return;
  withSandbox((sb) => {
    mkdirSync(sb.configDir, { recursive: true });
    const target = join(sb.root, "elsewhere.jsonc");
    writeFileSync(target, "{}");
    symlinkSync(target, join(sb.configDir, "kilo.jsonc"));
    const r = runInstall(sb, REQUIRED_ARGS, withPat);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /symlinks are not followed/);
    assert.equal(readFileSync(target, "utf8"), "{}");
    assert.deepEqual(readdirSync(sb.configDir), ["kilo.jsonc"]);
  });
});

test("AC-8 install.sh is LF only and passes bash -n", () => {
  const bytes = readFileSync(installShPath);
  assert.ok(!bytes.includes(13), "install.sh must not contain CR");
  assert.ok(bytes.toString("utf8").startsWith("#!/usr/bin/env bash\n"));
  const r = spawnSync(findBash(), ["-n", installShPath], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("AC-8 install.sh avoids eval, set -x and external commands", () => {
  const text = readFileSync(installShPath, "utf8");
  assert.doesNotMatch(text, /\beval\b|set -x|\bsed\b|\bawk\b|\bcat\b|\bdirname\b|\bmktemp\b/);
});
