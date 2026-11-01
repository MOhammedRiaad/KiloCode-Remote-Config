// Dev-only proof that a refactor of the plugin is move-and-comment only (ADR-0021 section 5).
// Compares a base version of backend/plugin/azdo-remote-config.ts with the working copy: declaration
// names, exports, __internals keys and the multiset of normalised top-level statements. Comments are
// ignored; string, template and regex literals are compared verbatim. node: imports only, no writes.
// Usage: node tools/compare-plugin-shape.mjs [--base-ref <ref> | --base-file <path>] [--head-file <path>]
// Exit codes: 0 PASS or SKIP, 1 difference, 2 usage or tokenizer error.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = "compare-plugin-shape";
const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(BACKEND_DIR, "..");
const PLUGIN_REL = "backend/plugin/azdo-remote-config.ts";
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const REGEX_PREV_PUNCT = new Set("(,=:[!&|?{};+-*%<>~^".split(""));
const REGEX_PREV_WORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw"]);
const OPENERS = new Set(["(", "[", "{"]);
const CLOSERS = new Set([")", "]", "}"]);
const DECLARATION = /^(?:export )?(?:default )?(?:async )?(?:function|const|let|var|type|interface|class|enum) (\S+)/;
const EXPORT_NAME = /^export (?:async )?(?:function|const|let|var|type|interface|class|enum) (\S+)/;
const MAX_SHOWN = 160;

class UsageError extends Error {}
class TokenizeError extends Error {}

function isWordChar(ch) {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

function skipQuoted(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === quote) return i + 1;
    else if (text[i] === "\n") break;
  }
  throw new TokenizeError(`unterminated string literal at offset ${start}`);
}

function skipTemplate(text, start) {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "`") return i + 1;
    else if (text[i] === "$" && text[i + 1] === "{") i = skipTemplateExpression(text, i + 2) - 1;
  }
  throw new TokenizeError(`unterminated template literal at offset ${start}`);
}

function skipTemplateExpression(text, start) {
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") i = skipQuoted(text, i) - 1;
    else if (ch === "`") i = skipTemplate(text, i) - 1;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i + 1;
  }
  throw new TokenizeError(`unterminated template expression at offset ${start}`);
}

function skipRegex(text, start) {
  let inClass = false;
  let i = start + 1;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") break;
    if (ch === "\\") i++;
    else if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      i++;
      while (isWordChar(text[i])) i++;
      return i;
    }
  }
  throw new TokenizeError(`unterminated regular expression literal at offset ${start}`);
}

function skipComment(text, start) {
  if (text[start + 1] === "/") {
    const end = text.indexOf("\n", start);
    return end === -1 ? text.length : end;
  }
  const end = text.indexOf("*/", start + 2);
  if (end === -1) throw new TokenizeError(`unterminated block comment at offset ${start}`);
  return end + 2;
}

function regexAllowed(prev) {
  if (prev === undefined) return true;
  return REGEX_PREV_PUNCT.has(prev) || REGEX_PREV_WORDS.has(prev);
}

/** Tokens with the bracket depth before them and a flag for "first on its line at column 0". */
export function tokenize(source) {
  const text = source.replace(/\r\n?/g, "\n");
  const tokens = [];
  let depth = 0;
  let lineStart = 0;
  let i = 0;
  const advance = (end) => {
    const lastNewline = text.lastIndexOf("\n", end - 1);
    if (lastNewline >= i) lineStart = lastNewline + 1;
    i = end;
  };
  const push = (end) => {
    tokens.push({ text: text.slice(i, end), depth, start: i === lineStart });
    advance(end);
  };
  while (i < text.length) {
    const ch = text[i];
    const prev = tokens.length > 0 ? tokens[tokens.length - 1].text : undefined;
    if (ch === "\n") advance(i + 1);
    else if (ch === " " || ch === "\t") i++;
    else if (ch === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) advance(skipComment(text, i));
    else if (ch === '"' || ch === "'") push(skipQuoted(text, i));
    else if (ch === "`") push(skipTemplate(text, i));
    else if (ch === "/" && regexAllowed(prev)) push(skipRegex(text, i));
    else if (isWordChar(ch)) push(wordEnd(text, i));
    else if (CLOSERS.has(ch)) {
      push(i + 1);
      depth--;
    } else {
      push(i + 1);
      if (OPENERS.has(ch)) depth++;
    }
  }
  return tokens;
}

function wordEnd(text, start) {
  let end = start;
  while (isWordChar(text[end])) end++;
  return end;
}

function splitStatements(tokens) {
  const statements = [];
  let current = [];
  for (const token of tokens) {
    const startsStatement = token.start && token.depth === 0 && !CLOSERS.has(token.text);
    if (startsStatement && current.length > 0) {
      statements.push(current);
      current = [];
    }
    current.push(token);
  }
  if (current.length > 0) statements.push(current);
  return statements;
}

function internalsKeys(statement) {
  const keys = [];
  let depth = 0;
  for (let i = 0; i < statement.length; i++) {
    const word = statement[i].text;
    if (OPENERS.has(word)) depth++;
    else if (CLOSERS.has(word)) depth--;
    else if (depth === 1 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(word) && [",", ":", "}"].includes(statement[i + 1]?.text)) {
      keys.push(word);
    }
  }
  return keys;
}

/** Shape of one plugin source text: normalised statements, declarations, exports, __internals keys. */
export function shapeOf(source) {
  const statements = splitStatements(tokenize(source));
  const normalised = statements.map((tokens) => tokens.map((t) => t.text).join(" "));
  const declarations = [];
  const exports = [];
  let internals = [];
  normalised.forEach((line, index) => {
    const declared = DECLARATION.exec(line);
    if (declared) declarations.push(declared[1]);
    const exported = EXPORT_NAME.exec(line);
    if (exported) exports.push(exported[1]);
    if (line.startsWith("export default ")) exports.push("default");
    if (declared && declared[1] === "__internals") internals = internalsKeys(statements[index]);
  });
  return {
    statements: normalised,
    declarations: declarations.sort(),
    exports: exports.sort(),
    internals: internals.sort(),
  };
}

function multisetDiff(base, head) {
  const counts = new Map();
  for (const item of base) counts.set(item, (counts.get(item) ?? 0) + 1);
  const onlyHead = [];
  for (const item of head) {
    const left = counts.get(item) ?? 0;
    if (left > 0) counts.set(item, left - 1);
    else onlyHead.push(item);
  }
  const onlyBase = [];
  for (const [item, left] of counts) for (let n = 0; n < left; n++) onlyBase.push(item);
  return { onlyBase, onlyHead };
}

function shorten(text) {
  return text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN)}...` : text;
}

function report(label, base, head, listIdentical) {
  const { onlyBase, onlyHead } = multisetDiff(base, head);
  if (onlyBase.length === 0 && onlyHead.length === 0) {
    const suffix = listIdentical ? ` (${base.join(", ")})` : "";
    return { ok: true, lines: [`${label}: ${base.length} identical${suffix}`] };
  }
  const lines = [`${label}: DIFFERENT`];
  for (const item of onlyBase) lines.push(`  only in base: ${shorten(item)}`);
  for (const item of onlyHead) lines.push(`  only in head: ${shorten(item)}`);
  return { ok: false, lines };
}

export function compareShapes(baseSource, headSource, baseLabel, headLabel) {
  const base = shapeOf(baseSource);
  const head = shapeOf(headSource);
  const results = [
    report("declarations", base.declarations, head.declarations, false),
    report("exports", base.exports, head.exports, true),
    report("__internals keys", base.internals, head.internals, true),
    report("statements: multiset of", base.statements, head.statements, false),
  ];
  const ok = results.every((r) => r.ok);
  const lines = [
    `${TOOL}: base ${baseLabel} (${base.statements.length} statements), head ${headLabel} (${head.statements.length} statements)`,
    ...results.flatMap((r) => r.lines),
    `${TOOL}: ${ok ? "PASS" : "FAIL"}`,
  ];
  return { ok, text: lines.join("\n") };
}

function parseArgs(argv) {
  const options = { baseRef: undefined, baseFile: undefined, headFile: undefined };
  const names = { "--base-ref": "baseRef", "--base-file": "baseFile", "--head-file": "headFile" };
  for (let i = 0; i < argv.length; i += 2) {
    const key = names[argv[i]];
    const value = argv[i + 1];
    if (key === undefined || value === undefined || value === "" || options[key] !== undefined) {
      throw new UsageError(`unexpected argument ${argv[i]}`);
    }
    options[key] = value;
  }
  if (options.baseRef !== undefined && options.baseFile !== undefined) {
    throw new UsageError("--base-ref and --base-file are mutually exclusive");
  }
  if (options.baseFile === undefined) options.baseRef ??= "HEAD";
  if (options.baseRef !== undefined && !REF_PATTERN.test(options.baseRef)) throw new UsageError("invalid --base-ref");
  options.headFile = resolve(options.headFile ?? resolve(BACKEND_DIR, "plugin", "azdo-remote-config.ts"));
  return options;
}

function readBase(options) {
  if (options.baseFile !== undefined) {
    const path = resolve(options.baseFile);
    return { source: readFileSync(path, "utf8"), label: path };
  }
  try {
    const source = execFileSync("git", ["-C", REPO_ROOT, "show", `${options.baseRef}:${PLUGIN_REL}`], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { source, label: options.baseRef };
  } catch {
    return undefined;
  }
}

function main(argv) {
  const options = parseArgs(argv);
  const base = readBase(options);
  if (base === undefined) {
    console.log(`${TOOL}: SKIP - base ${options.baseRef} unavailable (no git history)`);
    return 0;
  }
  const head = readFileSync(options.headFile, "utf8");
  const result = compareShapes(base.source, head, base.label, options.headFile);
  console.log(result.text);
  return result.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError || error instanceof TokenizeError) {
      console.error(`${TOOL}: ${error.message}`);
      process.exitCode = 2;
    } else if (error && error.code === "ENOENT") {
      console.error(`${TOOL}: file not found`);
      process.exitCode = 2;
    } else {
      throw error;
    }
  }
}
