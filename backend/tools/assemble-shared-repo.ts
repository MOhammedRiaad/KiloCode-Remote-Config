// Assembles the shared config repo (C1) working tree. Contract: contracts/shared-config-repo.md section 2.
import { chmodSync, constants, copyFileSync, lstatSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST: ReadonlyArray<readonly [string, string]> = [
  ["shared-config/.gitattributes", ".gitattributes"],
  ["shared-config/azure-pipelines.yml", "azure-pipelines.yml"],
  ["shared-config/kilo.jsonc", "kilo.jsonc"],
  ["shared-config/package.json", "package.json"],
  ["shared-config/set-branch-policies.sh", "set-branch-policies.sh"],
  ["validator/validate-kilo-config.ts", "validator/validate-kilo-config.ts"],
  ["validator/kilo-config-rules.ts", "validator/kilo-config-rules.ts"],
  ["validator/kilo-schema-subset.json", "validator/kilo-schema-subset.json"],
  ["plugin/azdo-remote-config.ts", "plugin/azdo-remote-config.ts"],
];

const USAGE = [
  "Usage:",
  "  node tools/assemble-shared-repo.ts <outdir>",
  "  node tools/assemble-shared-repo.ts --help",
  "",
  "Writes the shared config repo files into <outdir> (absent or an empty directory).",
  "",
].join("\n");

class ExitError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function usageError(reason: string): ExitError {
  return new ExitError(2, `assemble-shared-repo: usage error: ${reason}\n${USAGE}`);
}

function parseArgs(args: string[]): string | "help" {
  if (args.includes("--help") || args.includes("-h")) return "help";
  if (args.some((a) => a.startsWith("-"))) throw usageError("unknown option");
  const [first] = args;
  if (first === undefined || args.length > 1) throw usageError("expected one output directory");
  return first;
}

function checkOutdir(outdir: string): void {
  let stat;
  try {
    stat = lstatSync(outdir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  if (!stat.isDirectory() || readdirSync(outdir).length > 0) {
    throw usageError("output directory must be empty or absent");
  }
}

function checkSources(backendRoot: string): void {
  for (const [source] of MANIFEST) {
    let isFile = false;
    try {
      isFile = statSync(join(backendRoot, source)).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) throw new ExitError(1, `assemble-shared-repo: missing source file ${source}`);
  }
}

function writeTree(backendRoot: string, outdir: string): void {
  mkdirSync(join(outdir, "validator"), { recursive: true });
  mkdirSync(join(outdir, "plugin"), { recursive: true });
  for (const [source, target] of MANIFEST) {
    copyFileSync(join(backendRoot, source), join(outdir, target), constants.COPYFILE_EXCL);
  }
  if (process.platform !== "win32") chmodSync(join(outdir, "set-branch-policies.sh"), 0o755);
}

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "UNKNOWN";
}

function main(args: string[]): number {
  try {
    const parsed = parseArgs(args);
    if (parsed === "help") {
      process.stdout.write(USAGE);
      return 0;
    }
    const outdir = resolve(parsed);
    checkOutdir(outdir);
    const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    checkSources(backendRoot);
    writeTree(backendRoot, outdir);
    console.log(`assemble-shared-repo: wrote ${MANIFEST.length} files`);
    return 0;
  } catch (err) {
    if (err instanceof ExitError) {
      process.stderr.write(err.message.endsWith("\n") ? err.message : `${err.message}\n`);
      return err.code;
    }
    process.stderr.write(`assemble-shared-repo: cannot write output (${errorCode(err)})\n`);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
