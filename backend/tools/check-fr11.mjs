// FR-11 guard: zero runtime dependencies, single plugin file, node: imports only.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_FILE = "azdo-remote-config.ts";

function parseRoot(argv) {
  const i = argv.indexOf("--root");
  if (i === -1) return resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const value = argv[i + 1];
  if (!value) throw new Error("--root requires a directory");
  return resolve(value);
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function importSpecifiers(source) {
  const patterns = [
    /\bimport\s+(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:[\w*{}\s,$]+?)\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  return patterns.flatMap((re) => [...source.matchAll(re)].map((m) => m[1]));
}

function check(root) {
  const errors = [];
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) {
    errors.push("package.json not found");
  } else {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
      errors.push("package.json must have empty dependencies (FR-11)");
    }
  }

  const pluginDir = join(root, "plugin");
  const files = existsSync(pluginDir) ? readdirSync(pluginDir) : [];
  if (files.length !== 1 || files[0] !== PLUGIN_FILE) {
    errors.push(`plugin/ must contain only ${PLUGIN_FILE} (found: ${files.join(", ") || "nothing"})`);
  }

  const pluginPath = join(pluginDir, PLUGIN_FILE);
  if (existsSync(pluginPath)) {
    const source = stripComments(readFileSync(pluginPath, "utf8"));
    for (const spec of importSpecifiers(source)) {
      if (!spec.startsWith("node:")) errors.push(`non-node: import "${spec}" in ${PLUGIN_FILE}`);
    }
    if (/\brequire\s*\(/.test(source)) errors.push(`require( is not allowed in ${PLUGIN_FILE}`);
  }
  return errors;
}

try {
  const errors = check(parseRoot(process.argv.slice(2)));
  if (errors.length > 0) {
    for (const e of errors) console.error(`check-fr11: FAIL - ${e}`);
    process.exit(1);
  }
  console.log("check-fr11: PASS");
} catch (err) {
  console.error(`check-fr11: FAIL - ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
