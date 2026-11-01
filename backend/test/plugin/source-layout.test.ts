// Layout, JSDoc and comment-safety rules for the single plugin file (ADR-0021, T-037).
// The checkers are pure functions over source text; each rule is also run on mutated copies
// (negative controls) so that a checker that silently accepts everything cannot pass.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const pluginFile = resolve(here, "..", "..", "plugin", "azdo-remote-config.ts");
const archDir = resolve(here, "..", "..", "..", "docs", "architecture");
const SOURCE = readFileSync(pluginFile, "utf8").replace(/\r\n?/g, "\n");

const EXPECTED_SECTIONS = [
  "Imports, public types and plugin identity (ADR-0001, ADR-0002)",
  "Shared guards and helpers",
  "JSONC parser (ADR-0003)",
  "Placeholder resolver (ADR-0004)",
  "Config merge (ADR-0005)",
  "Settings resolution (ADR-0006, ADR-0009)",
  "Fetch foundations: types, target, URL and deadline (ADR-0007)",
  "Authentication: PAT and az CLI (ADR-0007)",
  "Response handling and failure classification (ADR-0007, ADR-0020)",
  "Fetch pipeline: fetchRemoteConfig (ADR-0007)",
  "Shared config validation (ADR-0008, ADR-0009)",
  "Config cache bound to settings (ADR-0008, ADR-0018)",
  "Logging, fixed messages and hints (ADR-0008, ADR-0020)",
  "Config hook: runConfigHook (ADR-0008)",
  "Exports: __internals, server and default export (ADR-0002)",
];

const HOT_PATHS = [
  "AzdoRemoteConfig", "runConfigHook", "executeHook", "acquireRemote", "resolveSettings",
  "fetchRemoteConfig", "runFetch", "performRequest", "buildItemsUrl", "resolveAuthorization",
  "findPat", "basicHeader", "azAuthorization", "defaultRunAz", "startDeadline",
  "codeForInterrupted", "handleResponse", "codeForStatus", "readContentType", "isJsonMediaType",
  "readCappedBody", "extractContent", "parseJsonc", "resolvePlaceholders", "mergeConfig",
  "applyShared", "validateShared", "readCache", "writeCache", "checkCacheEnvelope",
  "cacheBindingOf", "makeLogger", "hintFor", "logHint", "__internals",
];

const BANNER = /^\/\/ ==== (\d+)\. (.+) ====$/;
const TOC_ENTRY = /^\/\/ {3}(\d+)\. (.+)$/;

function sectionProblems(source: string): string[] {
  const lines = source.split("\n");
  const problems: string[] = [];
  const banners: Array<{ n: number; title: string }> = [];
  const toc: Array<{ n: number; title: string }> = [];
  let firstBanner = -1;
  lines.forEach((line, i) => {
    if (line.startsWith("// ---- ")) problems.push(`old section marker at line ${i + 1}`);
    if (!line.startsWith("// ====")) return;
    const m = BANNER.exec(line);
    if (m === null) return void problems.push(`malformed banner at line ${i + 1}`);
    if (firstBanner === -1) firstBanner = i;
    banners.push({ n: Number(m[1]), title: m[2]! });
    if (lines[i - 1] !== "" || lines[i + 1] !== "") problems.push(`banner ${m[1]} needs a blank line before and after`);
  });
  for (const line of lines.slice(0, firstBanner === -1 ? lines.length : firstBanner)) {
    const m = TOC_ENTRY.exec(line);
    if (m !== null) toc.push({ n: Number(m[1]), title: m[2]! });
  }
  const numbered = (list: typeof toc) => list.map((e) => e.n).join(",");
  const expectedNumbers = EXPECTED_SECTIONS.map((_, i) => i + 1).join(",");
  if (numbered(toc) !== expectedNumbers) problems.push(`TOC numbers are ${numbered(toc)}`);
  if (numbered(banners) !== expectedNumbers) problems.push(`banner numbers are ${numbered(banners)}`);
  if (toc.map((e) => e.title).join("|") !== EXPECTED_SECTIONS.join("|")) problems.push("TOC titles differ from the expected list");
  if (banners.map((e) => e.title).join("|") !== EXPECTED_SECTIONS.join("|")) problems.push("banner titles differ from the expected list");
  return problems;
}

function jsdocBefore(source: string, name: string): { problems: string[]; body: string } {
  const re = new RegExp(`^(?:export )?(?:async )?(?:function|const) ${name}\\b`, "gm");
  const hits = [...source.matchAll(re)];
  if (hits.length !== 1) return { problems: [`${name}: declared ${hits.length} times`], body: "" };
  const decl = hits[0]!.index;
  const end = source.lastIndexOf("*/", decl);
  const start = end === -1 ? -1 : source.lastIndexOf("/**", end);
  if (end === -1 || start === -1 || source.slice(end + 2, decl).trim() !== "") {
    return { problems: [`${name}: no JSDoc block directly above the declaration`], body: "" };
  }
  return { problems: [], body: source.slice(start + 3, end) };
}

function hotPathProblems(source: string): string[] {
  const problems: string[] = [];
  for (const name of HOT_PATHS) {
    const found = jsdocBefore(source, name);
    problems.push(...found.problems);
    if (found.problems.length > 0) continue;
    const lines = found.body.split("\n").map((l) => l.replace(/^\s*\* ?/, "").trimEnd()).filter((l) => l !== "");
    const purpose = lines.find((l) => !l.startsWith("@") && !/^\s/.test(l));
    if (purpose === undefined || !purpose.endsWith(".")) problems.push(`${name}: no purpose sentence`);
    if (!lines.some((l) => l.startsWith("Invariants:"))) problems.push(`${name}: no Invariants line`);
    if (!lines.some((l) => l.startsWith("@see "))) problems.push(`${name}: no @see`);
    if (/@(?:param|returns) \{/.test(found.body)) problems.push(`${name}: type braces in a tag`);
  }
  return problems;
}

function blocksOf(source: string): { problems: string[]; blocks: string[] } {
  const problems: string[] = [];
  const blocks: string[] = [];
  let pos = 0;
  for (;;) {
    const open = source.indexOf("/*", pos);
    const strayClose = source.indexOf("*/", pos);
    if (strayClose !== -1 && (open === -1 || strayClose < open)) {
      problems.push(`stray close sequence at offset ${strayClose}`);
      break;
    }
    if (open === -1) break;
    const close = source.indexOf("*/", open + 2);
    if (close === -1) return { problems: [...problems, "unterminated block comment"], blocks };
    const body = source.slice(open + 2, close);
    const lineStart = source.lastIndexOf("\n", open) + 1;
    if (source.slice(open, open + 3) !== "/**") problems.push(`block comment at offset ${open} is not a JSDoc block`);
    if (source.slice(lineStart, open).trim() !== "") problems.push(`block at offset ${open} is not first on its line`);
    if (source[close + 2] !== undefined && source[close + 2] !== "\n") problems.push(`block at offset ${open} does not end its line`);
    if (body.includes("/*")) problems.push(`block at offset ${open} contains an inner open sequence`);
    blocks.push(body);
    pos = close + 2;
  }
  return { problems, blocks };
}

function headingExists(file: string, heading: RegExp): boolean {
  return readFileSync(file, "utf8").split("\n").some((l) => heading.test(l));
}

function seeProblems(block: string): string[] {
  const problems: string[] = [];
  for (const m of block.matchAll(/^\s*\* @see (.+)$/gm)) {
    const target = m[1]!.trim();
    const adr = /^ADR-(\d{4})(?: section (\d+))?$/.exec(target);
    const contract = /^contracts\/([A-Za-z0-9.-]+\.md) section ([0-9A-Za-z-]+)$/.exec(target);
    if (adr !== null) {
      const file = readdirSync(archDir).find((f) => f.startsWith(`ADR-${adr[1]}-`) && f.endsWith(".md"));
      if (file === undefined) problems.push(`@see ${target}: no such ADR`);
      else if (adr[2] !== undefined && !headingExists(join(archDir, file), new RegExp(`^### ${adr[2]}\\. `))) {
        problems.push(`@see ${target}: no such section`);
      }
    } else if (contract !== null) {
      const file = join(archDir, "contracts", contract[1]!);
      if (!existsSync(file)) problems.push(`@see ${target}: no such contract`);
      else if (!headingExists(file, new RegExp(`^#{2,3} ${contract[2]}\\. `))) problems.push(`@see ${target}: no such section`);
    } else {
      problems.push(`@see ${target}: unknown form`);
    }
  }
  return problems;
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-bf-(?!<)/,
  /\b(?:Basic|Bearer)\s+(?=[A-Za-z0-9+/._~-]*\d)[A-Za-z0-9+/=._~-]{8,}/,
  /\b(?:Basic|Bearer)\s+[A-Za-z0-9+/._~-]{4,}={1,2}/,
  /dev\.azure\.com\/(?!<)[A-Za-z0-9]/,
];

function commentProblems(source: string): string[] {
  const problems: string[] = [];
  const nonAscii = [...source].findIndex((ch) => {
    const code = ch.charCodeAt(0);
    return !(code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126));
  });
  if (nonAscii !== -1) problems.push(`non-ASCII character at index ${nonAscii}`);
  const { problems: blockProblems, blocks } = blocksOf(source);
  problems.push(...blockProblems);
  for (const block of blocks) {
    problems.push(...seeProblems(block));
    for (const pattern of SECRET_PATTERNS) if (pattern.test(block)) problems.push(`secret-like text matches ${pattern}`);
  }
  return problems;
}

function mutate(from: string, to: string): string {
  assert.ok(SOURCE.includes(from), `mutation anchor missing: ${from}`);
  return SOURCE.replace(from, to);
}

function withBlock(lines: string[]): string {
  return mutate("function noop(): void {}", `${["/**", ...lines.map((l) => ` * ${l}`), " */"].join("\n")}\nfunction noop(): void {}`);
}

function hasProblem(problems: string[], pattern: RegExp): boolean {
  return problems.some((p) => pattern.test(p));
}

test("AC-1: TOC and numbered banners match the fixed list in order", () => {
  assert.deepEqual(sectionProblems(SOURCE), []);
  const lines = SOURCE.split("\n");
  assert.equal(lines.filter((l) => BANNER.test(l)).length, 15);
});

test("AC-1 negative controls: removed, swapped and renamed banners and a removed TOC entry are caught", () => {
  const banner = (n: number) => `// ==== ${n}. ${EXPECTED_SECTIONS[n - 1]} ====`;
  assert.ok(hasProblem(sectionProblems(mutate(`${banner(5)}\n`, "")), /banner numbers/));
  const swapped = mutate(banner(3), "@@3@@").replace(banner(4), banner(3)).replace("@@3@@", banner(4));
  assert.ok(hasProblem(sectionProblems(swapped), /banner numbers|banner titles/));
  assert.ok(hasProblem(sectionProblems(mutate(banner(7), banner(7).replace("Fetch", "Fetches"))), /banner titles/));
  assert.ok(hasProblem(sectionProblems(mutate(`//   9. ${EXPECTED_SECTIONS[8]}\n`, "")), /TOC numbers/));
  assert.ok(hasProblem(sectionProblems(mutate("// ==== 2.", "// === 2.")), /banner/));
  assert.ok(hasProblem(sectionProblems(`${SOURCE}\n// ---- old ----\n`), /old section marker/));
});

test("AC-1: the export default statement is the last statement and nothing follows section 15", () => {
  const body = SOURCE.trimEnd().split("\n");
  assert.equal(body[body.length - 1], "export default { id: PLUGIN_ID, server: AzdoRemoteConfig };");
  assert.equal(SOURCE.match(/^export default /gm)?.length, 1);
});

test("AC-2: every hot path has a JSDoc block with purpose, Invariants and @see", () => {
  assert.equal(HOT_PATHS.length, 35);
  assert.equal(new Set(HOT_PATHS).size, 35);
  assert.deepEqual(hotPathProblems(SOURCE), []);
});

test("AC-2 negative controls: stripped block, missing Invariants or @see, renamed function are caught", () => {
  const start = SOURCE.lastIndexOf("/**", SOURCE.indexOf("async function runFetch"));
  const end = SOURCE.indexOf("*/", start) + 3;
  const stripped = SOURCE.slice(0, start) + SOURCE.slice(end);
  assert.ok(hasProblem(hotPathProblems(stripped), /runFetch: no JSDoc/));
  const noInvariants = SOURCE.replace(/^ \* Invariants: pure and never throws\.$/m, " * Notes: pure.");
  assert.notEqual(noInvariants, SOURCE);
  assert.ok(hasProblem(hotPathProblems(noInvariants), /codeForInterrupted: no Invariants line/));
  const noSee = SOURCE.replace(" * @see ADR-0007 section 6\n */\nfunction basicHeader", " */\nfunction basicHeader");
  assert.notEqual(noSee, SOURCE);
  assert.ok(hasProblem(hotPathProblems(noSee), /basicHeader: no @see/));
  assert.ok(hasProblem(hotPathProblems(mutate("function findPat(", "function findPatX(")), /findPat: declared 0 times/));
  assert.ok(hasProblem(hotPathProblems(mutate("@param text - the JSONC", "@param {string} text - the JSONC")), /parseJsonc: type braces/));
  assert.ok(hasProblem(hotPathProblems(mutate("Parses JSON with comments and trailing commas.", "Parses JSON with comments and trailing commas")), /parseJsonc: no purpose/));
});

test("AC-3: comments are ASCII, whole-line JSDoc blocks, @see targets exist, no secret-like text", () => {
  assert.deepEqual(commentProblems(SOURCE), []);
});

test("AC-3 negative controls: secret, bad @see, non-ASCII and inner close sequence are caught", () => {
  const key = "sk-bf-" + "A1b2C3d4E5f6G7h8";
  assert.ok(hasProblem(commentProblems(withBlock(["Example.", `Key ${key}`])), /secret-like/));
  assert.ok(commentProblems(withBlock(["Example.", "Key sk-bf-<...>"])).length === 0);
  assert.ok(hasProblem(commentProblems(withBlock(["Example.", "Header Basic " + "QWxhZGRpbjpvcGVuIHNlc2FtZQ=="])), /secret-like/));
  assert.ok(hasProblem(commentProblems(withBlock(["Example.", "Url https://dev.azure.com/" + "contoso/p"])), /secret-like/));
  assert.ok(hasProblem(commentProblems(withBlock(["Example.", "@see ADR-9999"])), /no such ADR/));
  assert.ok(hasProblem(commentProblems(withBlock(["Example.", "@see ADR-0007 section 99"])), /no such section/));
  assert.ok(hasProblem(commentProblems(withBlock(["Example.", "@see contracts/plugin-interface.md section 99z"])), /no such section/));
  assert.ok(hasProblem(commentProblems(withBlock(["Example.", "@see contracts/missing.md section 2"])), /no such contract/));
  assert.ok(hasProblem(commentProblems(withBlock(["Example.", `Caf${String.fromCharCode(0xe9)}`])), /non-ASCII/));
  const closer = "*" + "/";
  assert.ok(commentProblems(withBlock(["Example.", `inner ${closer} text`])).length > 0);
  const opener = "/" + "*";
  assert.ok(hasProblem(commentProblems(withBlock(["Example.", `glob ${opener} text`])), /inner open|not a JSDoc|stray/));
  assert.ok(hasProblem(commentProblems(mutate("function noop(): void {}", `const x = 1; ${opener} c ${closer}\nfunction noop(): void {}`)), /not a JSDoc|not first/));
});

test("AC-6: a fresh process imports the plugin with the same exports and __internals keys", () => {
  const url = pathToFileURL(pluginFile).href;
  const script = [
    `const m = await import(${JSON.stringify(url)});`,
    "const server = m.default.server;",
    "console.log(JSON.stringify({",
    "  moduleKeys: Object.keys(m).sort(),",
    "  defaultKeys: Object.keys(m.default),",
    "  serverType: typeof server,",
    "  internals: Object.keys(m.__internals),",
    "}));",
  ].join("\n");
  const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, "");
  assert.deepEqual(JSON.parse(run.stdout), {
    moduleKeys: ["PLUGIN_ID", "SUPPORTED_KILO_RANGE", "__internals", "default"],
    defaultKeys: ["id", "server"],
    serverType: "function",
    internals: ["parseJsonc", "resolvePlaceholders", "mergeConfig", "resolveSettings", "fetchRemoteConfig", "runConfigHook"],
  });
});
