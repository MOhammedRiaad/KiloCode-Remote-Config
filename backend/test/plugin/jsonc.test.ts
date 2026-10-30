import assert from "node:assert/strict";
import { test } from "node:test";
import { __internals } from "../../plugin/azdo-remote-config.ts";

const { parseJsonc } = __internals;
const CANARY = "SECRET-CANARY-42";

function errorOf(text: unknown): Error {
  try {
    parseJsonc(text as string);
  } catch (e) {
    return e as Error;
  }
  throw new assert.AssertionError({ message: "expected parseJsonc to throw" });
}

test("AC-1: line and block comments, multi-line block, comment at EOF without newline", () => {
  const text = [
    "// header",
    "{",
    '  "a": 1, // trailing line comment',
    "  /* single */ \"b\": [1, /* mid */ 2],",
    "  /* multi",
    "     line",
    "     block */",
    '  "c": true',
    "} // end of file",
  ].join("\n");
  assert.deepEqual(parseJsonc(text), { a: 1, b: [1, 2], c: true });
  assert.deepEqual(parseJsonc("{} /* eof"+"*/"), {});
});

test("AC-2: trailing commas, nested, with whitespace and comments before the closer", () => {
  const text = `{
    "a": [1, 2, 3,],
    "b": { "c": 1, "d": { "e": [ {"f": 1,}, ], }, },
    "g": [1, // note
      /* gap */
    ],
    "h": { "i": 2 ,
    }
  }`;
  assert.deepEqual(parseJsonc(text), {
    a: [1, 2, 3],
    b: { c: 1, d: { e: [{ f: 1 }] } },
    g: [1],
    h: { i: 2 },
  });
});

test("AC-3: strings with URLs, comment-like text and ,} are preserved", () => {
  const text = '{"u": "https://host/path", "c": "/* not a comment */", "t": ",}", "l": "// x", "a": "[1,]"}';
  assert.deepEqual(parseJsonc(text), {
    u: "https://host/path",
    c: "/* not a comment */",
    t: ",}",
    l: "// x",
    a: "[1,]",
  });
});

test("AC-4: escaped quotes and strings ending in an escaped backslash", () => {
  const text = '{"q": "say \\"hi\\" // no", "p": "C:\\\\", "r": "x"} // real comment\n';
  assert.deepEqual(parseJsonc(text), { q: 'say "hi" // no', p: "C:\\", r: "x" });
  assert.deepEqual(parseJsonc('{"p": "C:\\\\" // c\n, "k": 1}'), { p: "C:\\", k: 1 });
});

test("AC-5: unterminated string reports position only", () => {
  const err = errorOf(`{\n  "k": "${CANARY}`);
  assert.ok(err instanceof Error);
  assert.equal(err.message, "Invalid JSONC: unterminated string starting at line 2, column 8");
  assert.equal(err.cause, undefined);
});

test("AC-5: unterminated block comment reports position only", () => {
  const err = errorOf(`{"a": 1}\n  /* ${CANARY}`);
  assert.equal(err.message, "Invalid JSONC: unterminated block comment starting at line 2, column 3");
  assert.equal(err.cause, undefined);
});

test("AC-5: malformed JSON has fixed message, no cause, no input echo", () => {
  for (const text of [`{"a": ${CANARY}}`, `{"${CANARY}" 1}`, `[1 2 ${CANARY}]`, ""]) {
    const err = errorOf(text);
    assert.equal(err.message, "Invalid JSONC: malformed JSON");
    assert.equal(err.cause, undefined);
    assert.ok(!err.message.includes(CANARY));
  }
});

test("AC-5: no error message ever contains the canary", () => {
  const inputs = [
    `"${CANARY}`,
    `/* ${CANARY}`,
    `{"a": ${CANARY}}`,
    `{"a": "${CANARY}"`,
    `${CANARY}`,
  ];
  for (const input of inputs) {
    const err = errorOf(input);
    assert.ok(err.message.startsWith("Invalid JSONC: "));
    assert.ok(!err.message.includes(CANARY));
    assert.equal(err.cause, undefined);
  }
});

test("non-string input throws TypeError", () => {
  for (const bad of [undefined, null, 1, {}, Buffer.from("{}")]) {
    const err = errorOf(bad);
    assert.ok(err instanceof TypeError);
    assert.equal(err.message, "Invalid JSONC: input must be a string");
  }
});

test("AC-6: VISION Appendix A example parses", () => {
  const text = `{
  "$schema": "https://app.kilo.ai/config.json",
  "provider": {
    "bifrost": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Bifrost",
      "options": { "baseURL": "https://bifrost.yourcompany.internal/v1" }, // no apiKey here, ever
      "models": { "azure/gpt-5": {}, "azure/gpt-5-mini": {} }
    }
  }
}`;
  const cfg = parseJsonc(text) as {
    provider: { bifrost: { options: { baseURL: string }; models: Record<string, unknown> } };
  };
  assert.equal(cfg.provider.bifrost.options.baseURL, "https://bifrost.yourcompany.internal/v1");
  assert.deepEqual(Object.keys(cfg.provider.bifrost.models), ["azure/gpt-5", "azure/gpt-5-mini"]);
});

test("leading BOM is ignored", () => {
  assert.deepEqual(parseJsonc('\uFEFF{"a": 1}'), { a: 1 });
});

test("CRLF and lone CR line endings work, comments end at the line break", () => {
  assert.deepEqual(parseJsonc('{\r\n "a": 1, // c\r\n "b": 2,\r\n}\r\n'), { a: 1, b: 2 });
  assert.deepEqual(parseJsonc('{ // c\r "a": 1 }'), { a: 1 });
});

test("error line numbers count CRLF as one break", () => {
  const err = errorOf('{\r\n"a": 1,\r\n"b": "x');
  assert.equal(err.message, "Invalid JSONC: unterminated string starting at line 3, column 6");
});

test("strict JSON gives the same result as JSON.parse", () => {
  const docs = [
    '{"a":[1,2,{"b":null}],"c":"d\\n\\u0041","e":-1.5e3,"f":false}',
    "[]",
    "42",
    '"str"',
    "null",
  ];
  for (const doc of docs) assert.deepEqual(parseJsonc(doc), JSON.parse(doc));
});

test("a trailing comma not followed by a closer stays invalid", () => {
  assert.equal(errorOf("[1,,2]").message, "Invalid JSONC: malformed JSON");
  assert.equal(errorOf("[1,").message, "Invalid JSONC: malformed JSON");
});
