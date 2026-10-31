import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "tools", "check-docs.mjs");

const PAGES = ["engineer-setup", "platform-runbook", "troubleshooting"] as const;
type Page = (typeof PAGES)[number];

const FIXTURE_RANGE = ">=9.1.0 <10.0.0";
const PLUGIN_FILE = "backend/plugin/azdo-remote-config.ts";
const SECRET = "sk-" + "bf-" + "Ab1".repeat(6);

// Required items per page as a single line of content each; `h` lines are headings.
const ITEMS: Record<Page, { id: string; line: string }[]> = {
  troubleshooting: [
    { id: "T1", line: "Set KILO_PURE=1 only for debugging." },
    { id: "T2", line: "CI jobs that need the shared config must not set KILO_PURE=1." },
    { id: "T3", line: "Run `az login` again." },
    { id: "T4", line: "Cache: ~/.cache/kilo-azdo/remote-config.json" },
    { id: "T5", line: "The validator returns exit code 4." },
    { id: "T6", line: "Use --no-smoke to skip it." },
    { id: "T7", line: "On Windows use -NoSmoke." },
  ],
  "engineer-setup": [
    { id: "E1", line: `Supported Kilo range: ${FIXTURE_RANGE}` },
    { id: "E2", line: "Run install.sh on Linux." },
    { id: "E3", line: "Run install.ps1 on Windows." },
    { id: "E4", line: "powershell -ExecutionPolicy Bypass -File setup.ps1" },
    { id: "E5", line: "Use Unblock-File if blocked." },
  ],
  "platform-runbook": [
    { id: "R1", line: "Assumption A1 holds." },
    { id: "R2", line: "Assumption A2 holds." },
    { id: "R3", line: "Assumption A3 holds." },
    { id: "R4", line: "Call GET /models." },
    { id: "R5", line: "Open VS Code." },
    { id: "R6", line: "The model list is fetched." },
    { id: "R7", line: "The .ts plugin loads." },
    { id: "R8", line: "Path resolution is local." },
    { id: "R9", line: "A disabled virtual key is rejected by Bifrost at request time." },
    { id: "R10", line: "## Phase 0" },
    { id: "R11", line: "## Shared config repo" },
    { id: "R12", line: "## Pipeline" },
    { id: "R13", line: "## Branch policies" },
    { id: "R14", line: "Run set-branch-policies.sh." },
    { id: "R15", line: "## Permissions" },
    { id: "R16", line: "Bypass policies is not granted." },
    { id: "R17", line: "Edit policies is not granted." },
    {
      id: "R18",
      line: "Bifrost virtual keys are issued and disabled manually by the platform team outside this project.",
    },
  ],
};

interface PageOpts {
  omitLink?: string;
  drop?: string[];
  replace?: Record<string, string>;
  extra?: string[];
}

function pageText(page: Page, opts: PageOpts = {}): string {
  const links = PAGES.filter((p) => p !== page && p !== opts.omitLink).map((p) => `[${p}](${p}.md)`);
  const items = ITEMS[page]
    .filter((i) => !(opts.drop ?? []).includes(i.id))
    .map((i) => opts.replace?.[i.id] ?? i.line);
  return [`# ${page}`, ...links, ...items, ...(opts.extra ?? [])].join("\n") + "\n";
}

function readmeText(omitLink?: string): string {
  const links = PAGES.filter((p) => p !== omitLink).map((p) => `[${p}](docs/${p}.md)`);
  return ["# Readme", ...links].join("\n") + "\n";
}

type Files = Record<string, string | null>;

function validFiles(): Files {
  const files: Files = { "README.md": readmeText(), [PLUGIN_FILE]: pluginText(FIXTURE_RANGE) };
  for (const p of PAGES) files[`docs/${p}.md`] = pageText(p);
  return files;
}

function pluginText(range: string): string {
  return `export const SUPPORTED_KILO_RANGE = "${range}";\n`;
}

function withFixture(overrides: Files, fn: (root: string) => void, eol = "\n"): void {
  const root = mkdtempSync(join(tmpdir(), "check-docs-"));
  try {
    for (const [rel, content] of Object.entries({ ...validFiles(), ...overrides })) {
      if (content === null) continue;
      const path = join(root, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, eol === "\n" ? content : content.replaceAll("\n", eol));
    }
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function run(root: string) {
  return spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
}

function expectFail(overrides: Files, expected: string[], eol = "\n"): void {
  withFixture(
    overrides,
    (root) => {
      const r = run(root);
      assert.equal(r.status, 1, r.stderr);
      for (const text of expected) assert.ok(r.stderr.includes(text), `missing ${text} in\n${r.stderr}`);
    },
    eol,
  );
}

function expectPass(overrides: Files, eol = "\n"): void {
  withFixture(
    overrides,
    (root) => {
      const r = run(root);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.startsWith("check-docs: PASS"));
    },
    eol,
  );
}

const userGuide = (...lines: string[]) => ({ "docs/user-guide.md": ["# Guide", ...lines].join("\n") + "\n" });

test("valid fixture passes", () => {
  expectPass({});
});

test("page-missing for README and each page", () => {
  for (const file of ["README.md", ...PAGES.map((p) => `docs/${p}.md`)]) {
    expectFail({ [file]: null }, [`${file}: page-missing`]);
  }
});

test("cross-link: each required link is enforced", () => {
  for (const src of PAGES) {
    for (const target of PAGES.filter((p) => p !== src)) {
      expectFail({ [`docs/${src}.md`]: pageText(src, { omitLink: target }) }, [
        `docs/${src}.md: cross-link: no relative link to docs/${target}.md`,
      ]);
    }
  }
  for (const target of PAGES) {
    expectFail({ "README.md": readmeText(target) }, [
      `README.md: cross-link: no relative link to docs/${target}.md`,
    ]);
  }
});

test("a typo in a cross-link fails link-broken and cross-link", () => {
  const text = pageText("troubleshooting", { omitLink: "engineer-setup" }) + "[x](engineer-setu.md)\n";
  expectFail({ "docs/troubleshooting.md": text }, [
    "docs/troubleshooting.md:10: link-broken: engineer-setu.md",
    "docs/troubleshooting.md: cross-link: no relative link to docs/engineer-setup.md",
  ]);
});

test("link-broken failures", () => {
  const cases: [string, string][] = [
    ["[a](missing.md)", "link-broken: missing.md (file not found)"],
    ["[a](platform-runbook.md#nope)", "link-broken: platform-runbook.md#nope (anchor not found)"],
    ["[a](../../x.md)", "link-broken: ../../x.md (outside the repository)"],
    ["[a](/etc/x.md)", "link-broken: /etc/x.md (absolute links are not allowed)"],
    ["[a](%zz.md)", "link-broken: %zz.md (invalid percent-encoding)"],
    ["[a]: missing.md", "link-broken: missing.md (file not found)"],
    ["[a](#nope)", "link-broken: #nope (anchor not found)"],
  ];
  for (const [line, message] of cases) {
    expectFail(userGuide(line), [`docs/user-guide.md:2: ${message}`]);
  }
});

test("link-broken passing cases", () => {
  expectPass(
    userGuide(
      "## X",
      "## X",
      "[a](#x) [b](#x-1) [c](platform-runbook.md#phase-0) [d](../README.md)",
      "[e](https://example.invalid/none.md) [f](mailto:a@example.invalid) [g](<troubleshooting.md> \"title\")",
      "`[h](missing.md)`",
      "```",
      "[i](missing.md)",
      "```",
    ),
  );
});

test("required-text: each item is enforced", () => {
  for (const page of PAGES) {
    for (const { id } of ITEMS[page]) {
      if (id === "E1") continue;
      const drop = id === "T1" ? ["T1", "T2"] : [id];
      expectFail({ [`docs/${page}.md`]: pageText(page, { drop }) }, [`docs/${page}.md: required-text: ${id} missing`]);
    }
  }
});

test("required-text: headings must be headings", () => {
  for (const id of ["R10", "R11", "R12", "R13", "R15"]) {
    const line = ITEMS["platform-runbook"].find((i) => i.id === id)!.line.replace("## ", "");
    const text = pageText("platform-runbook", { replace: { [id]: line } });
    expectFail({ "docs/platform-runbook.md": text }, [`required-text: ${id} missing heading`]);
  }
});

test("required-text: a phrase wrapped across lines passes", () => {
  const wrapped = ITEMS.troubleshooting[1]!.line.replaceAll(" ", "\n");
  expectPass({ "docs/troubleshooting.md": pageText("troubleshooting", { replace: { T2: wrapped } }) });
});

test("kilo-range is read at check time", () => {
  expectFail({ [PLUGIN_FILE]: pluginText(">=1.0.0 <2.0.0") }, [
    'docs/engineer-setup.md: kilo-range: supported Kilo range ">=1.0.0 <2.0.0" not found',
  ]);
  expectFail({ [PLUGIN_FILE]: "export const OTHER = 1;\n" }, [`${PLUGIN_FILE}: kilo-range`]);
  expectFail({ [PLUGIN_FILE]: null }, [`${PLUGIN_FILE}: kilo-range: cannot read`]);
});

test("secret-key: detection and non-detection", () => {
  const line = `key ${SECRET}`;
  withFixture({ "docs/architecture/nested/x.md": `# x\n${line}\n` }, (root) => {
    const r = run(root);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("docs/architecture/nested/x.md:2: secret-key"));
    assert.ok(!r.stderr.includes(SECRET) && !r.stdout.includes(SECRET));
  });
  expectFail({ "README.md": readmeText() + line + "\n" }, ["README.md:5: secret-key"]);
  expectFail({ "docs/x.MD": line.toUpperCase() + "\n" }, ["docs/x.MD:1: secret-key"]);
  const fifteen = "sk-" + "bf-" + "a".repeat(15);
  expectPass(userGuide("sk-bf-...", "sk-bf-<your-virtual-key>", fifteen, "sk-bf-"));
});

test("forbidden-text: four patterns on each page, not elsewhere", () => {
  const terms = ["provisioning", "offboarding", "teams/a", "per-team"];
  for (const page of PAGES) {
    for (const term of terms) {
      const base = pageText(page);
      const lineNo = base.split("\n").length;
      expectFail({ [`docs/${page}.md`]: pageText(page, { extra: [`Note ${term}`] }) }, [
        `docs/${page}.md:${lineNo}: forbidden-text`,
      ]);
    }
  }
  expectPass(userGuide(...terms));
});

test("CRLF input behaves like LF", () => {
  expectPass({}, "\r\n");
  expectFail({ "docs/troubleshooting.md": pageText("troubleshooting", { drop: ["T2"] }) }, ["required-text: T2 missing"], "\r\n");
});

test("usage errors and help", () => {
  const exec = (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  assert.equal(exec(["--bogus"]).status, 2);
  assert.equal(exec(["positional"]).status, 2);
  assert.equal(exec(["--root"]).status, 2);
  assert.equal(exec(["--root", join(tmpdir(), "check-docs-does-not-exist")]).status, 2);
  const help = exec(["--help"]);
  assert.equal(help.status, 0);
  assert.ok(help.stdout.startsWith("usage:"));
  assert.equal(exec(["-h"]).status, 0);
});

test("all findings are reported", () => {
  expectFail({ "README.md": null, ...userGuide(`key ${SECRET}`) }, [
    "README.md: page-missing",
    "docs/user-guide.md:2: secret-key",
    "check-docs: FAIL (2 problem(s))",
  ]);
});

test("link forms never echo a secret key", () => {
  const forms = [`[x](${SECRET})`, `[x]: ${SECRET}`, `[x](#${SECRET})`, `[x](a.md#${SECRET})`];
  for (const form of forms) {
    withFixture({ ...userGuide(form), "docs/a.md": "# A\n" }, (root) => {
      const r = run(root);
      assert.equal(r.status, 1, form);
      assert.ok(r.stderr.includes("docs/user-guide.md:2: secret-key"), form);
      assert.ok(!r.stderr.toLowerCase().includes(SECRET.toLowerCase()), form);
      assert.ok(!r.stdout.toLowerCase().includes(SECRET.toLowerCase()), form);
    });
  }
  withFixture(userGuide(`[x](${SECRET})`), (root) => {
    assert.ok(run(root).stderr.includes("docs/user-guide.md:2: secret-key"));
  });
});

test("kilo-range message never echoes a secret key", () => {
  withFixture({ [PLUGIN_FILE]: pluginText(`>=${SECRET}`) }, (root) => {
    const r = run(root);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("kilo-range"));
    assert.ok(!r.stderr.includes(SECRET));
  });
});

test("links through a junction or symlink leaving the root fail", (t) => {
  const outside = mkdtempSync(join(tmpdir(), "check-docs-outside-"));
  try {
    writeFileSync(join(outside, "secret.md"), "# hello\n");
    withFixture(userGuide("[a](j/secret.md#hello)", "[b](j/secret.md#nope)", "[c](j/secret.md)"), (root) => {
      try {
        symlinkSync(outside, join(root, "docs", "j"), "junction");
      } catch {
        t.skip("cannot create junction");
        return;
      }
      const r = run(root);
      assert.equal(r.status, 1);
      for (const line of [2, 3, 4]) {
        assert.ok(
          r.stderr.includes(`docs/user-guide.md:${line}: link-broken`) && r.stderr.includes("(outside the repository)"),
          r.stderr,
        );
      }
    });
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a very long line skips link extraction but keeps the secret scan", () => {
  const long = "x".repeat(10001);
  expectFail(userGuide(`${long} [a](missing.md) ${SECRET}`), [
    "docs/user-guide.md:2: line-too-long",
    "docs/user-guide.md:2: secret-key",
  ]);
  withFixture(userGuide(`${long} [a](missing.md)`), (root) => {
    assert.ok(!run(root).stderr.includes("link-broken"));
  });
});
