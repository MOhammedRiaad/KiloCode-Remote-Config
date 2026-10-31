import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __internals } from "../../plugin/azdo-remote-config.ts";
import { backendRoot, backups, isWindows, snapshot } from "./helpers.ts";
import {
  assertNoInstallerFootprint,
  helperPath,
  installPs1Path,
  psTest,
  readLog,
  referenceConfig,
  removeNodeStub,
  runInstallPs,
  stubAzPs,
  stubNodePs,
  withPsSandbox,
} from "./ps-helpers.ts";
import type { PsRunResult, PsSandbox } from "./ps-helpers.ts";

const KEY = "sk-bf-AbCdEf1234567890";
const PAT = "SENTINEL_PAT_VALUE_0014";
const CANARY = "ARGCANARY0014";
const ARGS = ["-Org", "acme", "-Project", "proj", "-Repo", "cfg"];
const REF_ARGS = ["--org", "acme", "--project", "proj", "--repo", "cfg"];
const withPat = { AZDO_PAT: PAT };
const pluginSource = readFileSync(join(backendRoot, "plugin", "azdo-remote-config.ts"));
const parse = (path: string) => __internals.parseJsonc(readFileSync(path, "utf8")) as Record<string, any>;
const configFile = (sb: PsSandbox) => join(sb.configDir, "kilo.jsonc");

const EXISTING =
  "// my comment\n{\n" +
  '  "model": "bifrost/x", // inline\n' +
  '  "plugin": [\n    "my-other-plugin",\n    ["./plugin/azdo-remote-config.ts", {"org": "old", "pat": "OLD_PAT_VALUE",},],\n  ],\n' +
  '  "provider": {\n    "other": {"name": "keep", "options": {"x": [1, 2]}},\n' +
  '    "bifrost": {"options": {"apiKey": "sk-bf-existing", "headers": {"X-Team": "t"}}},\n  },\n}\n';

const NO_CREDS =
  "install.ps1: error: No Azure DevOps credentials: install the Azure CLI and run 'az login', or set AZDO_PAT to a personal access token with Code (Read) scope.";
const NOT_LOGGED_IN =
  "install.ps1: error: The Azure CLI is not logged in: run 'az login', or set AZDO_PAT to a personal access token with Code (Read) scope.";
const NO_NODE = "install.ps1: error: Node.js was not found on PATH. Install Node.js 22.18 or later and re-run.";
const XDG_WARNING =
  "install.ps1: warning: XDG_CONFIG_HOME is set: make sure only your account can read that folder, because kilo.jsonc holds your Bifrost virtual key.";

function seed(sb: PsSandbox, text: string): void {
  mkdirSync(sb.configDir, { recursive: true });
  writeFileSync(configFile(sb), text);
}

function noSecrets(r: PsRunResult): void {
  const combined = r.stdout + r.stderr;
  for (const secret of [KEY, "AbCdEf1234567890", PAT, "OLD_PAT_VALUE"]) {
    assert.equal(combined.includes(secret), false, `output leaked ${secret}`);
  }
  assert.doesNotMatch(combined, /\n\s+at /);
}

// ---- AC-1 fresh install ----

psTest(
  "AC-1 fresh install matches install.sh byte for byte",
  (host) => {
    withPsSandbox((sb) => {
      const env = { ...withPat, KILO_BIFROST_KEY: KEY };
      const r = runInstallPs(sb, host, [...ARGS, "-Path", "teams/core/kilo.jsonc", "-Branch", "release/1", "-Mode", "enforce"], env);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stderr, "");
      assert.match(r.stdout, /^Installed plugin: .*\nCreated personal config: .*\nDone\.\n$/);
      assert.deepEqual(readFileSync(join(sb.configDir, "azdo", "azdo-remote-config.ts")), pluginSource);
      const config = parse(configFile(sb));
      assert.deepEqual(config["plugin"], [
        [
          "./azdo/azdo-remote-config.ts",
          { org: "acme", project: "proj", repo: "cfg", path: "/teams/core/kilo.jsonc", branch: "release/1", mode: "enforce" },
        ],
      ]);
      assert.equal(config["provider"].bifrost.options.apiKey, KEY);
      const reference = referenceConfig(undefined, env, [
        ...REF_ARGS,
        "--path",
        "teams/core/kilo.jsonc",
        "--branch",
        "release/1",
        "--mode",
        "enforce",
      ]);
      assert.deepEqual(readFileSync(configFile(sb)), reference);
      noSecrets(r);
    });
  },
  true,
);

psTest("AC-1 default settings and the key placeholder", (host) => {
  withPsSandbox((sb) => {
    const r = runInstallPs(sb, host, ARGS, withPat);
    assert.equal(r.status, 0, r.stderr);
    const config = parse(configFile(sb));
    assert.deepEqual(config["plugin"][0][1], {
      org: "acme",
      project: "proj",
      repo: "cfg",
      path: "/kilo.jsonc",
      branch: "main",
      mode: "defaults",
    });
    assert.equal(config["provider"].bifrost.options.apiKey, "sk-bf-<your-virtual-key>");
    assert.match(r.stdout, /Set your Bifrost virtual key: re-run with KILO_BIFROST_KEY set/);
  });
});

psTest("AC-1 XDG_CONFIG_HOME selects the target directory", (host) => {
  withPsSandbox((sb) => {
    const r = runInstallPs(sb, host, ARGS, { ...withPat, XDG_CONFIG_HOME: sb.xdg });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(sb.xdg, "kilo", "kilo.jsonc")));
    assert.ok(existsSync(join(sb.xdg, "kilo", "azdo", "azdo-remote-config.ts")));
    assert.equal(existsSync(sb.configDir), false);
    assert.equal(r.stderr.includes(XDG_WARNING), isWindows);
  });
});

psTest("AC-1 a relative XDG_CONFIG_HOME is a usage error with install.ps1 wording", (host) => {
  withPsSandbox((sb) => {
    const r = runInstallPs(sb, host, ARGS, { ...withPat, XDG_CONFIG_HOME: "relative/dir" });
    assert.equal(r.status, 2);
    assert.ok(
      r.stderr.endsWith("install.ps1: error: XDG_CONFIG_HOME must be an absolute path.\nRun install.ps1 -Help for usage.\n"),
      r.stderr,
    );
  });
});

// ---- AC-2 inputs ----

psTest("AC-2 environment inputs are used and parameters beat them", (host) => {
  withPsSandbox((sb) => {
    const env = {
      ...withPat,
      KILO_AZDO_ORG: "envorg",
      KILO_AZDO_PROJECT: "envproj",
      KILO_AZDO_REPO: "envrepo",
      KILO_AZDO_PATH: "envdir/c.jsonc",
      KILO_AZDO_BRANCH: "dev",
      KILO_AZDO_MODE: "enforce",
    };
    const r = runInstallPs(sb, host, [], env);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(parse(configFile(sb))["plugin"][0][1], {
      org: "envorg",
      project: "envproj",
      repo: "envrepo",
      path: "/envdir/c.jsonc",
      branch: "dev",
      mode: "enforce",
    });
    const second = runInstallPs(sb, host, ["-ORG", "flagorg", "-project", "flagproj", "-Mode", "defaults", "-Mode", "enforce"], env);
    assert.equal(second.status, 0, second.stderr);
    const options = parse(configFile(sb))["plugin"][0][1];
    assert.equal(options.org, "flagorg");
    assert.equal(options.project, "flagproj");
    assert.equal(options.repo, "envrepo");
    assert.equal(options.mode, "enforce");
  });
}, true);

psTest("AC-2 an empty parameter counts as absent", (host) => {
  withPsSandbox((sb) => {
    const r = runInstallPs(sb, host, ["-Org", "", "-Project", "proj", "-Repo", "cfg"], { ...withPat, KILO_AZDO_ORG: "envorg" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(parse(configFile(sb))["plugin"][0][1].org, "envorg");
  });
});

for (const missing of ["Org", "Project", "Repo"]) {
  psTest(
    `AC-2 missing -${missing} gives exit 2 naming the input`,
    (host) => {
      withPsSandbox((sb) => {
        const args: string[] = [];
        for (const name of ["Org", "Project", "Repo"]) if (name !== missing) args.push(`-${name}`, "v");
        const r = runInstallPs(sb, host, args, withPat);
        assert.equal(r.status, 2);
        assert.equal(
          r.stderr,
          `install.ps1: error: missing required input -${missing} (or KILO_AZDO_${missing.toUpperCase()}).\nRun install.ps1 -Help for usage.\n`,
        );
        assertNoInstallerFootprint(sb);
        assert.deepEqual(readLog(sb, "node-argv.log"), []);
      });
    },
    missing === "Org",
  );
}

psTest("AC-2 all missing inputs are reported", (host) => {
  withPsSandbox((sb) => {
    const r = runInstallPs(sb, host, []);
    assert.equal(r.status, 2);
    assert.equal(r.stderr.match(/missing required input/g)?.length, 3);
  });
});

const BAD_ARGUMENTS: [string, string[]][] = [
  ["-ApiKey", ["-ApiKey", CANARY]],
  ["-Key", ["-Key", CANARY]],
  ["-Pat", ["-Pat", CANARY]],
  ["-BifrostKey", ["-BifrostKey", CANARY]],
  ["GNU style", ["--org", CANARY]],
  ["abbreviation", ["-Or", CANARY]],
  ["positional", [CANARY]],
  ["flag without value", ["-Org"]],
  ["-NoSmoke with a value", ["-NoSmoke", CANARY]],
];

for (const [label, extra] of BAD_ARGUMENTS) {
  psTest(
    `AC-2 usage error for ${label}: exit 2, no echo, nothing written, node not run`,
    (host) => {
      withPsSandbox((sb) => {
        const r = runInstallPs(sb, host, [...ARGS, ...extra], { ...withPat, KILO_BIFROST_KEY: KEY });
        assert.equal(r.status, 2);
        assert.equal(r.stderr, "install.ps1: error: unknown option or argument.\nRun install.ps1 -Help for usage.\n");
        assert.equal(r.stdout, "");
        assert.equal((r.stdout + r.stderr).includes(CANARY), false);
        noSecrets(r);
        assertNoInstallerFootprint(sb);
        assert.deepEqual(readLog(sb, "node-argv.log"), []);
      });
    },
    label === "-ApiKey" || label === "positional",
  );
}

psTest("AC-2 a usage error wins over a missing node", (host) => {
  withPsSandbox((sb) => {
    removeNodeStub(sb);
    const r = runInstallPs(sb, host, [...ARGS, "-Key", CANARY]);
    assert.equal(r.status, 2);
    assert.equal(r.stderr.includes(CANARY), false);
  });
});

for (const help of ["-Help", "-h", "-?", "--help", "-HELP"]) {
  psTest(
    `AC-2 ${help} prints usage without checks or writes`,
    (host) => {
      withPsSandbox((sb) => {
        removeNodeStub(sb);
        const r = runInstallPs(sb, host, ["-Org", "x", help, "-Bogus"]);
        assert.equal(r.status, 0, r.stderr);
        assert.ok(r.stdout.startsWith("Usage: install.ps1 -Org <org> -Project <project> -Repo <repo>"));
        assert.match(r.stdout, /Exit codes: 0 ok, 1 prerequisite, 2 usage, 3 file system, 4 installed but smoke test failed\.\n/);
        assert.equal(r.stderr, "");
        assert.deepEqual(readLog(sb, "node-argv.log"), []);
        assert.deepEqual(readLog(sb, "az.log"), []);
        assertNoInstallerFootprint(sb);
      });
    },
    help === "-Help",
  );
}

// ---- AC-3 update ----

psTest(
  "AC-3 update keeps other settings, backs up byte-identically and matches install.sh",
  (host) => {
    withPsSandbox((sb) => {
      seed(sb, EXISTING);
      const r = runInstallPs(sb, host, ARGS, withPat);
      assert.equal(r.status, 0, r.stderr);
      const config = parse(configFile(sb));
      assert.equal(config["model"], "bifrost/x");
      assert.deepEqual(config["provider"].other, { name: "keep", options: { x: [1, 2] } });
      assert.deepEqual(config["provider"].bifrost.options.headers, { "X-Team": "t" });
      assert.equal(config["provider"].bifrost.options.apiKey, "sk-bf-existing");
      assert.equal(config["plugin"].length, 2);
      assert.equal(config["plugin"][0], "my-other-plugin");
      assert.deepEqual(config["plugin"][1], [
        "./azdo/azdo-remote-config.ts",
        { org: "acme", project: "proj", repo: "cfg", path: "/kilo.jsonc", branch: "main", mode: "defaults" },
      ]);
      const found = backups(sb.configDir);
      assert.equal(found.length, 1);
      assert.equal(readFileSync(join(sb.configDir, found[0] as string), "utf8"), EXISTING);
      assert.match(r.stdout, /dropped plugin options from the previous entry: pat/);
      assert.deepEqual(readFileSync(configFile(sb)), referenceConfig(EXISTING, withPat, REF_ARGS));
      noSecrets(r);
    });
  },
  true,
);

psTest("AC-3 a supplied key replaces the stored one", (host) => {
  withPsSandbox((sb) => {
    seed(sb, EXISTING);
    const env = { ...withPat, KILO_BIFROST_KEY: KEY };
    const r = runInstallPs(sb, host, ARGS, env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(parse(configFile(sb))["provider"].bifrost.options.apiKey, KEY);
    assert.deepEqual(readFileSync(configFile(sb)), referenceConfig(EXISTING, env, REF_ARGS));
    noSecrets(r);
  });
});

psTest("AC-3 an invalid existing config is refused without changes", (host) => {
  withPsSandbox((sb) => {
    seed(sb, '{"plugin": {');
    const before = snapshot(sb.configDir);
    const r = runInstallPs(sb, host, ARGS, withPat);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /^install\.ps1: error: .* is not valid JSONC \(.*\); fix or move it, then re-run\.\n$/);
    assert.deepEqual(snapshot(sb.configDir), before);
  });
});

psTest("AC-3 a rejected setting value is reported with install.ps1 wording", (host) => {
  withPsSandbox((sb) => {
    const r = runInstallPs(sb, host, [...ARGS, "-Mode", "bogus"], withPat);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^install\.ps1: error: invalid value for -Mode: .*\nRun install\.ps1 -Help for usage\.\n$/);
    assertNoInstallerFootprint(sb);
  });
});

// ---- AC-4 plugin location and idempotence ----

for (const start of ["fresh", "update"]) {
  psTest(`AC-4 ${start} start: one entry, no plugin dirs, second run changes nothing`, (host) => {
    withPsSandbox((sb) => {
      if (start === "update") seed(sb, EXISTING);
      const first = runInstallPs(sb, host, ARGS, withPat);
      assert.equal(first.status, 0, first.stderr);
      const text = readFileSync(configFile(sb), "utf8");
      assert.equal(text.split("azdo-remote-config.ts").length - 1, 1);
      assert.deepEqual(readdirSync(sb.configDir).filter((n) => n === "plugin" || n === "plugins"), []);
      const before = snapshot(sb.configDir);
      const count = backups(sb.configDir).length;
      const second = runInstallPs(sb, host, ARGS, withPat);
      assert.equal(second.status, 0, second.stderr);
      assert.deepEqual(snapshot(sb.configDir), before);
      assert.equal(backups(sb.configDir).length, count);
      assert.match(second.stdout, /Plugin already up to date: /);
      assert.match(second.stdout, /Personal config already up to date: /);
    });
  });
}

psTest("AC-4 an auto-loaded copy triggers an install.ps1 warning and stays untouched", (host) => {
  withPsSandbox((sb) => {
    mkdirSync(join(sb.configDir, "plugin"), { recursive: true });
    const old = join(sb.configDir, "plugin", "azdo-remote-config.ts");
    writeFileSync(old, "old copy");
    const r = runInstallPs(sb, host, ARGS, withPat);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /^install\.ps1: warning: .* is auto-loaded by Kilo and would load the plugin twice; remove it\.\n$/);
    assert.equal(readFileSync(old, "utf8"), "old copy");
  });
});

// ---- AC-5 prerequisites ----

psTest(
  "AC-5 no az and no PAT: exit 1 with the fix, nothing written",
  (host) => {
    withPsSandbox((sb) => {
      const r = runInstallPs(sb, host, ARGS);
      assert.equal(r.status, 1);
      assert.equal(r.stderr, `${NO_CREDS}\n`);
      assertNoInstallerFootprint(sb);
    });
  },
  true,
);

psTest("AC-5 az present but not logged in: exit 1, nothing written", (host) => {
  withPsSandbox((sb) => {
    stubAzPs(sb, "fail");
    const r = runInstallPs(sb, host, ARGS);
    assert.equal(r.status, 1);
    assert.equal(r.stderr, `${NOT_LOGGED_IN}\n`);
    assert.deepEqual(readLog(sb, "az.log"), ["account show --output none"]);
    assertNoInstallerFootprint(sb);
  });
});

psTest("AC-5 a logged-in az satisfies the credential check", (host) => {
  withPsSandbox((sb) => {
    stubAzPs(sb, "ok");
    const r = runInstallPs(sb, host, ARGS);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readLog(sb, "az.log"), ["account show --output none"]);
  });
});

for (const name of ["AZDO_PAT", "AZURE_DEVOPS_EXT_PAT", "KILO_AZDO_PAT"]) {
  psTest(`AC-5 ${name} skips az entirely`, (host) => {
    withPsSandbox((sb) => {
      stubAzPs(sb, "fail");
      const r = runInstallPs(sb, host, ARGS, { [name]: PAT });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(existsSync(join(sb.root, "az.log")), false);
    });
  });
}

psTest("AC-5 Node missing: exit 1", (host) => {
  withPsSandbox((sb) => {
    removeNodeStub(sb);
    const r = runInstallPs(sb, host, ARGS, withPat);
    assert.equal(r.status, 1);
    assert.equal(r.stderr, `${NO_NODE}\n`);
    assertNoInstallerFootprint(sb);
  });
});

psTest("AC-5 Node older than 22.18: exit 1 naming the version", (host) => {
  withPsSandbox((sb) => {
    stubNodePs(sb, "22.17.0");
    const r = runInstallPs(sb, host, ARGS, withPat);
    assert.equal(r.status, 1);
    assert.equal(r.stderr, "install.ps1: error: Node.js 22.18 or later is required (found 22.17.0).\n");
    assertNoInstallerFootprint(sb);
  });
});

psTest("AC-5 an unusable Node version string is shown as unknown", (host) => {
  withPsSandbox((sb) => {
    stubNodePs(sb, "not a version!");
    const r = runInstallPs(sb, host, ARGS, withPat);
    assert.equal(r.status, 1);
    assert.equal(r.stderr, "install.ps1: error: Node.js 22.18 or later is required (found unknown).\n");
  });
});

psTest(
  "AC-5 every failing prerequisite is reported",
  (host) => {
    withPsSandbox((sb) => {
      stubNodePs(sb, "18.0.0");
      const r = runInstallPs(sb, host, ARGS);
      assert.equal(r.status, 1);
      assert.equal(r.stderr, `install.ps1: error: Node.js 22.18 or later is required (found 18.0.0).\n${NO_CREDS}\n`);
      assertNoInstallerFootprint(sb);
    });
    withPsSandbox((sb) => {
      removeNodeStub(sb);
      stubAzPs(sb, "fail");
      const r = runInstallPs(sb, host, ARGS);
      assert.equal(r.status, 1);
      assert.equal(r.stderr, `${NO_NODE}\n${NOT_LOGGED_IN}\n`);
    });
  },
  true,
);

for (const version of ["22.18.0", "23.0.1"]) {
  psTest(`AC-5 Node ${version} passes the version check`, (host) => {
    withPsSandbox((sb) => {
      stubNodePs(sb, version);
      const r = runInstallPs(sb, host, ARGS, withPat);
      assert.equal(r.status, 0, r.stderr);
    });
  });
}

if (isWindows) {
  psTest("AC-5 an extensionless node or az file is ignored on Windows", (host) => {
    withPsSandbox((sb) => {
      stubAzPs(sb, "ok");
      writeFileSync(join(sb.bin, "node"), "#!/bin/sh\nexit 7\n");
      writeFileSync(join(sb.bin, "az"), "#!/bin/sh\nexit 7\n");
      const r = runInstallPs(sb, host, ARGS);
      assert.equal(r.status, 0, r.stderr);
    });
  });
}

psTest("AC-5 a missing helper gives exit 3 and writes nothing", (host) => {
  withPsSandbox((sb) => {
    const lonely = mkdtempSync(join(tmpdir(), "kilo-ps-lone-"));
    try {
      const script = join(lonely, "install.ps1");
      copyFileSync(installPs1Path, script);
      const r = runInstallPs(sb, host, ARGS, withPat, { script });
      assert.equal(r.status, 3);
      assert.equal(r.stderr, "install.ps1: error: installer sources are missing (expected install-helper.ts next to install.ps1).\n");
      assertNoInstallerFootprint(sb);
    } finally {
      rmSync(lonely, { recursive: true, force: true });
    }
  });
});

// ---- AC-7 secrets ----

psTest(
  "AC-7 the key and PAT never reach output or argv logs (success, usage error, prerequisite failure)",
  (host) => {
    const env = { ...withPat, KILO_BIFROST_KEY: KEY };
    const isAllowed = (line: string) =>
      line === "-p process.versions.node" || line.toLowerCase() === `"${helperPath}"`.toLowerCase();
    withPsSandbox((sb) => {
      const ok = runInstallPs(sb, host, ARGS, env);
      assert.equal(ok.status, 0, ok.stderr);
      noSecrets(ok);
      const lines = readLog(sb, "node-argv.log");
      assert.ok(lines.length >= 2);
      for (const line of lines) assert.ok(isAllowed(line), `unexpected node argv: ${line}`);
      assert.ok(!readFileSync(configFile(sb), "utf8").includes(PAT));
      const usage = runInstallPs(sb, host, [...ARGS, "-Key", KEY], env);
      assert.equal(usage.status, 2);
      noSecrets(usage);
    });
    withPsSandbox((sb) => {
      stubAzPs(sb, "fail");
      const r = runInstallPs(sb, host, ARGS, { KILO_BIFROST_KEY: KEY });
      assert.equal(r.status, 1);
      noSecrets(r);
      assert.deepEqual(readLog(sb, "az.log"), ["account show --output none"]);
      for (const line of readLog(sb, "node-argv.log")) assert.ok(isAllowed(line), `unexpected node argv: ${line}`);
    });
  },
  true,
);

psTest("AC-7 a key with control characters is rejected without echo", (host) => {
  withPsSandbox((sb) => {
    const r = runInstallPs(sb, host, ARGS, { ...withPat, KILO_BIFROST_KEY: `${KEY}\tx` });
    assert.equal(r.status, 2);
    noSecrets(r);
    assertNoInstallerFootprint(sb);
  });
});
