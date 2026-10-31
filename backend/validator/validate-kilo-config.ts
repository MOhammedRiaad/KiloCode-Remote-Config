// CLI for the shared Kilo config validator (ADR-0010, contracts/validator-cli.md).
// Prints findings (never input values) and exits 0 (ok), 1 (validation errors) or 2 (usage/io/internal).
import { readFileSync, statSync } from "node:fs";
import {
  MAX_FILE_BYTES,
  MAX_PRINTED_FINDINGS,
  fileTooLargeFinding,
  parseAllowedHosts,
  validateConfigBytes,
  type Finding,
} from "./kilo-config-rules.ts";

const USAGE = [
  "usage: node validate-kilo-config.ts [--allowed-hosts <list>] [--] <file> [<file>...]",
  "       node validate-kilo-config.ts --help",
].join("\n");

interface Args {
  files: string[];
  allowedHosts: Set<string> | undefined;
  help: boolean;
}

class UsageError extends Error {}

interface Totals {
  valid: number;
  invalid: number;
  unreadable: number;
}

function cleanName(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    out += code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? "?" : name.charAt(i);
  }
  return out;
}

function addHosts(current: Set<string> | undefined, list: string | undefined): Set<string> {
  if (list === undefined) throw new UsageError("--allowed-hosts requires a value");
  const parsed = parseAllowedHosts(list);
  if (!parsed) throw new UsageError("--allowed-hosts must be a comma-separated list of host names");
  return new Set([...(current ?? []), ...parsed]);
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { files: [], allowedHosts: undefined, help: false };
  let onlyFiles = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (onlyFiles || !arg.startsWith("-")) args.files.push(arg);
    else if (arg === "--") onlyFiles = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--allowed-hosts") args.allowedHosts = addHosts(args.allowedHosts, argv[++i]);
    else if (arg.startsWith("--allowed-hosts=")) {
      args.allowedHosts = addHosts(args.allowedHosts, arg.slice("--allowed-hosts=".length));
    } else throw new UsageError("unknown option");
  }
  if (!args.help && args.files.length === 0) throw new UsageError("at least one file is required");
  return args;
}

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "UNKNOWN";
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string): void {
  process.stderr.write(`${line}\n`);
}

type ReadResult = { bytes: Buffer | undefined } | { ioError: string };

// Only I/O is guarded here; the size check runs before the file is read.
function readFile(path: string): ReadResult {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return { ioError: "not a regular file" };
    return { bytes: stat.size > MAX_FILE_BYTES ? undefined : readFileSync(path) };
  } catch (err) {
    return { ioError: `cannot read file (${errorCode(err)})` };
  }
}

function validateFile(read: { bytes: Buffer | undefined }, hosts: Set<string> | undefined): Finding[] {
  return read.bytes ? validateConfigBytes(read.bytes, { allowedHosts: hosts }) : [fileTooLargeFinding()];
}

function report(name: string, findings: Finding[]): boolean {
  for (const f of findings.slice(0, MAX_PRINTED_FINDINGS)) {
    out(`${name}: ${f.severity} ${f.rule} at ${f.location}: ${f.message}`);
  }
  if (findings.length > MAX_PRINTED_FINDINGS) {
    out(`${name}: note: ${findings.length - MAX_PRINTED_FINDINGS} more findings not shown`);
  }
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  if (errors > 0) out(`${name}: invalid (${errors} errors, ${warnings} warnings)`);
  else if (warnings > 0) out(`${name}: valid (${warnings} warnings)`);
  else out(`${name}: valid`);
  return errors === 0;
}

function run(argv: readonly string[]): number {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    fail(`validate-kilo-config: usage error: ${err.message}`);
    fail(USAGE);
    return 2;
  }
  if (args.help) {
    out(USAGE);
    return 0;
  }
  const totals: Totals = { valid: 0, invalid: 0, unreadable: 0 };
  for (const file of args.files) {
    const name = cleanName(file);
    const read = readFile(file);
    if ("ioError" in read) {
      fail(`${name}: io-error: ${read.ioError}`);
      totals.unreadable++;
    } else if (report(name, validateFile(read, args.allowedHosts))) totals.valid++;
    else totals.invalid++;
  }
  const n = args.files.length;
  out(
    `validate-kilo-config: ${n} files checked: ${totals.valid} valid, ${totals.invalid} invalid, ${totals.unreadable} unreadable.`,
  );
  if (totals.unreadable > 0) return 2;
  return totals.invalid > 0 ? 1 : 0;
}

function main(): void {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch {
    fail("validate-kilo-config: internal error");
    process.exitCode = 2;
  }
}

main();
