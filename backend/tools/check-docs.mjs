// Docs gate (ADR-0017, contract docs/architecture/contracts/docs-check.md).
// Read-only: no writes, no network, no subprocesses. Imports node: built-ins only.
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process, { argv, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const USAGE = "usage: node backend/tools/check-docs.mjs [--root <dir>]\n";
const PLUGIN_PATH = "backend/plugin/azdo-remote-config.ts";
const README = "README.md";
const PAGES = ["docs/engineer-setup.md", "docs/platform-runbook.md", "docs/troubleshooting.md"];
const MAX_LINK_LINE = 10000;
const SECRET_KEY = /sk-bf-[A-Za-z0-9]{16,}/gi;
const FENCE = /^ {0,3}(```|~~~)/;
const HEADING = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

const phrase = (id, value) => ({ id, kind: "phrase", value });
const regex = (id, value) => ({ id, kind: "regex", value });
const heading = (id, value) => ({ id, kind: "heading", value });

const REQUIRED = {
  "docs/troubleshooting.md": [
    phrase("T1", "kilo_pure=1"),
    phrase("T2", "ci jobs that need the shared config must not set kilo_pure=1"),
    phrase("T3", "az login"),
    phrase("T4", "~/.cache/kilo-azdo/remote-config.json"),
    phrase("T5", "exit code 4"),
    phrase("T6", "--no-smoke"),
    phrase("T7", "-nosmoke"),
  ],
  "docs/engineer-setup.md": [
    phrase("E2", "install.sh"),
    phrase("E3", "install.ps1"),
    phrase("E4", "-executionpolicy bypass"),
    phrase("E5", "unblock-file"),
  ],
  "docs/platform-runbook.md": [
    regex("R1", /\bA1\b/),
    regex("R2", /\bA2\b/),
    regex("R3", /\bA3\b/),
    phrase("R4", "/models"),
    phrase("R5", "vs code"),
    phrase("R6", "model list"),
    phrase("R7", ".ts plugin"),
    phrase("R8", "path resolution"),
    phrase("R9", "disabled virtual key is rejected by bifrost at request time"),
    heading("R10", "phase 0"),
    heading("R11", "shared config repo"),
    heading("R12", "pipeline"),
    heading("R13", "branch polic"),
    phrase("R14", "set-branch-policies.sh"),
    heading("R15", "permissions"),
    phrase("R16", "bypass policies"),
    phrase("R17", "edit policies"),
    phrase(
      "R18",
      "bifrost virtual keys are issued and disabled manually by the platform team outside this project",
    ),
  ],
};

const FORBIDDEN = [
  { label: "provision", re: /provision/i },
  { label: "offboard", re: /offboard/i },
  { label: "teams/", re: /teams[/\\]/i },
  { label: "per-team", re: /per-team/i },
];

class UsageError extends Error {}

function parseArgs(args) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  let rootSeen = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg !== "--root" || rootSeen || i + 1 >= args.length) throw new UsageError();
    rootSeen = true;
    root = resolve(args[++i]);
  }
  let isDir = false;
  try {
    isDir = statSync(root).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new UsageError();
  return { help: false, root };
}

function isRegularFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function collectDocs(dir, rel, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const childRel = `${rel}/${entry.name}`;
    if (entry.isDirectory()) collectDocs(join(dir, entry.name), childRel, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) out.push(childRel);
  }
}

function scannedSet(root) {
  const files = [];
  if (isRegularFile(join(root, README))) files.push(README);
  try {
    if (lstatSync(join(root, "docs")).isDirectory()) collectDocs(join(root, "docs"), "docs", files);
  } catch {
    // no docs directory: nothing to scan
  }
  return files;
}

function readLines(text) {
  const lines = text.split(/\r?\n/);
  const fenced = [];
  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      fenced.push(true);
    } else {
      fenced.push(inFence);
    }
  }
  return { lines, fenced };
}

function headingText(raw) {
  return raw.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

function slugOf(raw) {
  return headingText(raw)
    .replaceAll("`", "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replaceAll(" ", "-");
}

function slugsOf(text) {
  const { lines, fenced } = readLines(text);
  const seen = new Map();
  const slugs = new Set();
  lines.forEach((line, i) => {
    const m = fenced[i] ? null : HEADING.exec(line);
    if (!m) return;
    const base = slugOf(m[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  });
  return slugs;
}

function headingsOf(text) {
  const { lines, fenced } = readLines(text);
  const out = [];
  lines.forEach((line, i) => {
    const m = fenced[i] ? null : HEADING.exec(line);
    if (m) {
      out.push(headingText(m[1]).replace(/[`*]/g, "").replace(/\s+/g, " ").trim().toLowerCase());
    }
  });
  return out;
}

function normalise(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^>(?: )?/, ""))
    .join("\n")
    .replace(/[`*]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function targetOf(group) {
  const t = group.trim();
  if (t.startsWith("<")) {
    const end = t.indexOf(">");
    return end === -1 ? t.slice(1) : t.slice(1, end);
  }
  return t.split(/\s/)[0];
}

function extractLinks(text, onLongLine) {
  const { lines, fenced } = readLines(text);
  const links = [];
  lines.forEach((line, i) => {
    if (fenced[i]) return;
    if (line.length > MAX_LINK_LINE) {
      onLongLine(i + 1);
      return;
    }
    const def = /^ {0,3}\[[^\]]+\]:\s*(\S+)/.exec(line);
    if (def) links.push({ line: i + 1, target: def[1].replace(/[<>]/g, "") });
    const plain = line.replace(/(`+)[^`]*?\1/g, "");
    for (const m of plain.matchAll(/!?\[[^\]]*\]\(([^)]*)\)/g)) {
      const target = targetOf(m[1]);
      if (target) links.push({ line: i + 1, target });
    }
  });
  return links;
}

function toPosix(path) {
  return path.split(sep).join("/");
}

// Returns { error } or { resolved, fragment } for a link target found in `source`.
function resolveTarget(root, source, target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) return { external: true };
  if (target.startsWith("#")) {
    try {
      return { resolved: join(root, source), fragment: decodeURIComponent(target.slice(1)) };
    } catch {
      return { error: "invalid percent-encoding" };
    }
  }
  if (target.startsWith("/") || target.startsWith("\\")) {
    return { error: "absolute links are not allowed" };
  }
  const hash = target.indexOf("#");
  const rawPath = (hash === -1 ? target : target.slice(0, hash)).split("?")[0];
  const rawFragment = hash === -1 ? "" : target.slice(hash + 1);
  try {
    const path = decodeURIComponent(rawPath);
    const fragment = decodeURIComponent(rawFragment);
    const resolved = path === "" ? join(root, source) : resolve(dirname(join(root, source)), path);
    return { resolved, fragment };
  } catch {
    return { error: "invalid percent-encoding" };
  }
}

function isInside(root, path) {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function realOrNull(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function createContext(root) {
  const findings = [];
  const realRoot = realOrNull(root) ?? root;
  const slugCache = new Map();
  return {
    root,
    realRoot,
    findings,
    add(file, line, rule, message) {
      findings.push({ file, line, rule, message });
    },
    slugsFor(absPath) {
      if (!slugCache.has(absPath)) {
        let slugs = null;
        try {
          slugs = slugsOf(readFileSync(absPath, "utf8"));
        } catch {
          slugs = null;
        }
        slugCache.set(absPath, slugs);
      }
      return slugCache.get(absPath);
    },
  };
}

function checkLink(ctx, source, link) {
  const res = resolveTarget(ctx.root, source, link.target);
  if (res.external) return;
  const fail = (why) => ctx.add(source, link.line, "link-broken", `${link.target} (${why})`);
  if (res.error) return fail(res.error);
  if (!isInside(ctx.root, res.resolved)) return fail("outside the repository");
  const real = realOrNull(res.resolved);
  if (real === null) return fail("file not found");
  if (!isInside(ctx.realRoot, real)) return fail("outside the repository");
  const checkable = res.fragment && res.resolved.toLowerCase().endsWith(".md");
  if (!checkable) return;
  if (!isRegularFile(real)) return fail("anchor not found");
  const slugs = ctx.slugsFor(real);
  if (!slugs || !slugs.has(res.fragment)) fail("anchor not found");
}

function checkLinks(ctx, source, text) {
  const tooLong = (line) =>
    ctx.add(source, line, "line-too-long", `links not checked on lines over ${MAX_LINK_LINE} characters`);
  for (const link of extractLinks(text, tooLong)) checkLink(ctx, source, link);
}

function linkedPaths(ctx, source, text) {
  const paths = new Set();
  for (const link of extractLinks(text, () => {})) {
    const res = resolveTarget(ctx.root, source, link.target);
    if (res.resolved && !res.error && isInside(ctx.root, res.resolved)) {
      paths.add(toPosix(relative(ctx.root, res.resolved)));
    }
  }
  return paths;
}

function checkCrossLinks(ctx, source, text, targets) {
  const linked = linkedPaths(ctx, source, text);
  for (const target of targets) {
    if (target !== source && !linked.has(target)) {
      ctx.add(source, null, "cross-link", `no relative link to ${target}`);
    }
  }
}

function checkRequired(ctx, page, text) {
  const norm = normalise(text);
  const heads = headingsOf(text);
  for (const item of REQUIRED[page] ?? []) {
    const ok =
      item.kind === "regex"
        ? item.value.test(text)
        : item.kind === "heading"
          ? heads.some((h) => h.includes(item.value))
          : norm.includes(item.value);
    if (!ok) {
      const what = item.kind === "regex" ? `pattern ${item.value}` : `${item.kind} "${item.value}"`;
      ctx.add(page, null, "required-text", `${item.id} missing ${what}`);
    }
  }
}

function checkKiloRange(ctx, text) {
  const page = "docs/engineer-setup.md";
  let range = null;
  try {
    const source = readFileSync(join(ctx.root, PLUGIN_PATH), "utf8");
    range = /^export const SUPPORTED_KILO_RANGE\s*=\s*"([^"\r\n]+)"\s*;/m.exec(source)?.[1] ?? null;
  } catch {
    range = null;
  }
  if (range === null) {
    ctx.add(PLUGIN_PATH, null, "kilo-range", "cannot read SUPPORTED_KILO_RANGE");
    return;
  }
  const wanted = range.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalise(text).includes(wanted)) {
    ctx.add(page, null, "kilo-range", `supported Kilo range "${range}" not found`);
  }
}

function checkLineRules(ctx, file, text, isPage) {
  text.split(/\r?\n/).forEach((line, i) => {
    if (/sk-bf-[A-Za-z0-9]{16,}/i.test(line)) {
      ctx.add(file, i + 1, "secret-key", "possible Bifrost virtual key (value not shown)");
    }
    if (!isPage) return;
    for (const { label, re } of FORBIDDEN) {
      if (re.test(line)) {
        ctx.add(file, i + 1, "forbidden-text", `"${label}" (out of scope by user decision)`);
      }
    }
  });
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortFindings(findings) {
  return findings.sort(
    (a, b) =>
      compare(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0) || compare(a.rule, b.rule),
  );
}

function runChecks(root) {
  const ctx = createContext(root);
  const files = scannedSet(root);
  for (const file of [README, ...PAGES]) {
    if (!isRegularFile(join(root, file))) {
      ctx.add(file, null, "page-missing", "required page does not exist");
    }
  }
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    const isPage = PAGES.includes(file);
    checkLinks(ctx, file, text);
    checkLineRules(ctx, file, text, isPage);
    if (isPage) checkRequired(ctx, file, text);
    if (isPage) checkCrossLinks(ctx, file, text, PAGES);
    if (file === README) checkCrossLinks(ctx, file, text, PAGES);
    if (file === "docs/engineer-setup.md") checkKiloRange(ctx, text);
  }
  return { findings: sortFindings(ctx.findings), count: files.length };
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    stderr.write(USAGE);
    return 2;
  }
  if (parsed.help) {
    stdout.write(USAGE);
    return 0;
  }
  const { findings, count } = runChecks(parsed.root);
  if (findings.length === 0) {
    stdout.write(`check-docs: PASS (${count} markdown files checked)\n`);
    return 0;
  }
  const lines = findings.map((f) => {
    const where = f.line === null ? f.file : `${f.file}:${f.line}`;
    const message = f.message.replace(SECRET_KEY, "sk-bf-<redacted>");
    return `check-docs: FAIL ${where}: ${f.rule}: ${message}\n`;
  });
  stderr.write(lines.join("") + `check-docs: FAIL (${findings.length} problem(s))\n`);
  return 1;
}

try {
  process.exitCode = main();
} catch (error) {
  stderr.write(`check-docs: internal error (${error?.code ?? "unknown"})\n`);
  process.exitCode = 2;
}
