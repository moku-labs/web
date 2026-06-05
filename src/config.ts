/**
 * @file Framework configuration — Config + Events types, core plugin registration.
 * @see README.md
 */
import { createCoreConfig } from "@moku-labs/core";
import { envPlugin } from "./plugins/env";
import { logPlugin } from "./plugins/log";

/**
 * Deployment stage. Drives content draft visibility — drafts are suppressed
 * only in `"production"`; `"development"` and `"test"` both surface them.
 */
export type Stage = "production" | "development" | "test";

/**
 * Global framework configuration. Minimal by design — per-plugin config is
 * resolved via `pluginConfigs`, not merged here.
 */
export type Config = {
  /** Deployment stage. Drives content draft visibility (drafts hidden only in `"production"`). */
  stage: Stage;
  /**
   * Render mode — the single SSG/DATA/SPA switch, read by the router (`ctx.global`)
   * and consumed by `build`/`spa` via `router.mode()`.
   * - `"ssg"` static generation only (no client router emitted).
   * - `"spa"` client-side routing only.
   * - `"hybrid"` static HTML + client navigation overlay (default).
   */
  mode: "ssg" | "spa" | "hybrid";
};

/**
 * Framework event contract. Empty base — each plugin declares its own events
 * via the `events` register callback (spec/14 §2).
 */
// biome-ignore lint/complexity/noBannedTypes: framework declares no global events; plugins own theirs.
export type Events = {};

/**
 * Step 1 of the factory chain — captures the framework's `Config`/`Events` contract
 * and registers the core plugins (`log`, `env`) whose APIs are injected onto every
 * regular plugin's context. Consumers never use this directly; it backs the exported
 * {@link createPlugin} and {@link createCore}.
 *
 * @example
 * ```ts
 * const { createPlugin, createCore } = coreConfig;
 * ```
 */
export const coreConfig = createCoreConfig<Config, Events, [typeof logPlugin, typeof envPlugin]>(
  "web",
  {
    config: { stage: "production", mode: "hybrid" },
    plugins: [logPlugin, envPlugin],
    pluginConfigs: {
      // Core-plugin defaults (levels 1–2 of the 4-level core cascade, spec/03 §5).
      // NOTE: env providers are intentionally NOT set here. The Node providers
      // (`dotenv`, `processEnv`) import `node:fs`, so baking them in would block
      // the isomorphic default app in the browser. The consumer supplies the
      // provider for its target via `createApp({ pluginConfigs: { env: { providers } } })`
      // — `[dotenv(), processEnv()]` on Node, `[browserEnv()]` in the browser.
      log: { mode: "production" }
    }
  }
);

/**
 * Create a custom plugin bound to this framework's `Config`/`Events` and the core
 * plugin APIs (`log`, `env`). Plugin types are fully inferred from the spec
 * object — never write them explicitly. This is the binding every built-in
 * plugin is wired with, and the one consumer plugins should use too.
 *
 * @example
 * ```ts
 * const analytics = createPlugin("analytics", {
 *   config: { writeKey: "" },
 *   api: (ctx) => ({ track: (event: string) => ctx.log.info("analytics:track", { event }) })
 * });
 * ```
 */
export const createPlugin = coreConfig.createPlugin;

/**
 * Step 2 of the factory chain — captures the framework's default plugin set and
 * returns the consumer entry points ({@link createApp} + a re-exported
 * `createPlugin`). Wired once in `src/index.ts`; consumers don't call it directly.
 */
export const createCore = coreConfig.createCore;
