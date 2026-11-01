import assert from "node:assert/strict";
import { test } from "node:test";
import { firstUnsafeTarget, lstatOrNull } from "../../installer/fs-guard.ts";
import type { LstatLike, Target } from "../../installer/fs-guard.ts";

type Entry = "dir" | "file" | "link" | null;

const fakeLstat =
  (entries: Record<string, Entry>): LstatLike =>
  (path) => {
    const kind = entries[path] ?? null;
    if (kind === null) return null;
    return { isDirectory: () => kind === "dir", isFile: () => kind === "file" };
  };

const targets: Target[] = [
  { path: "/c", kind: "dir", required: true },
  { path: "/c/azdo", kind: "dir", required: true },
  { path: "/c/azdo/p.ts", kind: "file", required: false },
  { path: "/c/kilo.jsonc", kind: "file", required: false },
];

test("firstUnsafeTarget returns null when every target is fine", () => {
  const lstat = fakeLstat({ "/c": "dir", "/c/azdo": "dir", "/c/azdo/p.ts": "file", "/c/kilo.jsonc": "file" });
  assert.equal(firstUnsafeTarget(targets, lstat), null);
});

test("firstUnsafeTarget reports a symlink-like configDir", () => {
  const lstat = fakeLstat({ "/c": "link", "/c/azdo": "dir" });
  assert.equal(firstUnsafeTarget(targets, lstat), "/c");
});

test("firstUnsafeTarget reports the first failure in order", () => {
  const lstat = fakeLstat({ "/c": "dir", "/c/azdo": "link", "/c/kilo.jsonc": "link" });
  assert.equal(firstUnsafeTarget(targets, lstat), "/c/azdo");
});

test("firstUnsafeTarget reports a missing required directory", () => {
  assert.equal(firstUnsafeTarget(targets, fakeLstat({ "/c": "dir" })), "/c/azdo");
});

test("firstUnsafeTarget accepts missing optional files", () => {
  assert.equal(firstUnsafeTarget(targets, fakeLstat({ "/c": "dir", "/c/azdo": "dir" })), null);
});

test("firstUnsafeTarget reports a file target that is a directory or link", () => {
  const base = { "/c": "dir", "/c/azdo": "dir" } as const;
  assert.equal(firstUnsafeTarget(targets, fakeLstat({ ...base, "/c/kilo.jsonc": "dir" })), "/c/kilo.jsonc");
  assert.equal(firstUnsafeTarget(targets, fakeLstat({ ...base, "/c/azdo/p.ts": "link" })), "/c/azdo/p.ts");
});

test("firstUnsafeTarget propagates unexpected lstat errors", () => {
  const lstat: LstatLike = () => {
    throw Object.assign(new Error("denied"), { code: "EACCES" });
  };
  assert.throws(() => firstUnsafeTarget(targets, lstat), { code: "EACCES" });
});

test("lstatOrNull returns null for a missing path", () => {
  assert.equal(lstatOrNull("/definitely/not/here/kilo-fs-guard"), null);
});
