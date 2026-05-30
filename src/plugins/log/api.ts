/**
 * @file log plugin — API factory skeleton.
 *
 * Builds the `LogApi` over the plugin's `{ config, state }` core context:
 * the leveled loggers (via a shared `append`), the frozen `trace()` snapshot,
 * the live `expect()` chain, `addSink`, and `reset`.
 */
import type { LogApi, LogState } from "./types";

/** Core-plugin context surface available to the log API factory. */
type LogContext = {
  readonly config: Readonly<{ mode: "test" | "dev" | "production" | "silent" }>;
  readonly state: LogState;
};

/**
 * Create the log plugin API surface injected as `ctx.log` / `app.log`.
 *
 * @param _ctx - Core plugin context (`{ config, state }`).
 * @example
 * ```ts
 * const log = createLogApi(ctx);
 * log.info("content:ready", { articleCount: 12 });
 * ```
 */
export function createLogApi(_ctx: LogContext): LogApi {
  // Wiring note: domain implementation will append to ctx.state.entries,
  // fan out to ctx.state.sinks, and back expect() via createExpectChain.
  throw new Error("not implemented");
}
