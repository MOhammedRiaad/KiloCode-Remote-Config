// azdo-remote-config: Kilo plugin that applies a remote Azure DevOps config.
// Single file, zero runtime dependencies (FR-11). See docs/architecture/ADR-0001-tech-stack.md
// and ADR-0002-plugin-module-shape.md. T-001 stub: no I/O, no logging.

/** Kilo log levels accepted by client.app.log. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Minimal subset of the Kilo plugin input that this plugin uses. Everything else is ignored. */
export interface PluginInput {
  client?: {
    app?: {
      log?: (args: {
        body: { service: string; level: LogLevel; message: string; extra?: Record<string, unknown> };
      }) => unknown | Promise<unknown>;
    };
  };
  directory?: string;
  worktree?: string;
  [key: string]: unknown;
}

/** Raw plugin options from the `plugin` tuple; validated later by F-features (FR-1). */
export type PluginOptions = Record<string, unknown> | undefined;

/** Kilo's resolved config: an arbitrary JSON object mutated in place. */
export type KiloConfig = Record<string, unknown>;

export interface Hooks {
  config: (config: KiloConfig) => Promise<void>;
}

export type PluginServer = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>;

export const PLUGIN_ID = "azdo-remote-config";

export const SUPPORTED_KILO_RANGE = ">=7.2.0 <8.0.0";

/** Test/validator seam. Empty in T-001; never has a `server` key and never holds the entry point. */
export const __internals = {};

const AzdoRemoteConfig: PluginServer = async () => {
  return { config: async () => {} };
};

export default { id: PLUGIN_ID, server: AzdoRemoteConfig };
