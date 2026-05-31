/**
 * @file Core plugin: universal env injection — schema + providers + PUBLIC_ cross-validation at onInit.
 * @see README.md
 */
import { createCorePlugin } from "@moku-labs/core";
import { createEnvApi } from "./api";
import { createEnvState } from "./state";
import type { EnvConfig } from "./types";
import { validateSchema } from "./validate";

/** Plugin config defaults (R6 typed const). `providers: []` — framework sets `[dotenv(), processEnv()]` via the 4-level cascade. */
const defaultEnvConfig: EnvConfig = { schema: {}, providers: [], publicPrefix: "PUBLIC_" };

/**
 * Core plugin that resolves, validates, and freezes the environment at `onInit`,
 * exposing a read-only accessor at `ctx.env`. No `onStart`/`onStop` — holds no resource.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { env: { schema: { PUBLIC_API_URL: { public: true } } } } });
 * ```
 */
export const envPlugin = createCorePlugin("env", {
  config: defaultEnvConfig,
  createState: createEnvState,
  api: createEnvApi,
  onInit: validateSchema
});
// NOTE: the Node providers (`dotenv`, `processEnv`, `cloudflareBindings`) are
// deliberately NOT re-exported here — they import `node:fs`, and this barrel is
// reachable from the browser `./client` entry via `coreConfig → envPlugin`.
// Import them directly from `./providers` at the Node entry (`src/index.ts`).
// `browserEnv` is `node:*`-free, so it stays on the barrel for the client entry.
export { browserEnv } from "./providers.browser";
export type { EnvApi, EnvConfig, EnvProvider, EnvState, EnvVarSpec } from "./types";
