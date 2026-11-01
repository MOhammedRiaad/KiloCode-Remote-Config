// Target re-check for the installer write phase (ADR-0012 section 6, contract installer-cli.md 1.2.1).
// Kept apart from install-helper.ts, which runs on import, so the logic can be unit tested.
import { lstatSync } from "node:fs";
import type { Stats } from "node:fs";

export type TargetKind = "dir" | "file";

export interface Target {
  readonly path: string;
  readonly kind: TargetKind;
  readonly required: boolean;
}

export type LstatLike = (path: string) => { isFile(): boolean; isDirectory(): boolean } | null;

export function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw err;
  }
}

// Returns the first target that is not what the installer expects (a symlink fails both type checks).
export function firstUnsafeTarget(targets: readonly Target[], lstat: LstatLike = lstatOrNull): string | null {
  for (const target of targets) {
    const stat = lstat(target.path);
    if (stat === null) {
      if (target.required) return target.path;
      continue;
    }
    const ok = target.kind === "dir" ? stat.isDirectory() : stat.isFile();
    if (!ok) return target.path;
  }
  return null;
}
