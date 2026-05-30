/**
 * @file log plugin — output sink factories skeleton.
 *
 * Houses the built-in console sink and the onInit sink-installation helper. New
 * sinks (file/JSON) can be added here later without any change to the log API
 * (the `LogSink` seam).
 */
import type { LogConfig, LogSink, LogState } from "./types";

/**
 * Build the console sink: routes entries to `console.error` (error),
 * `console.warn` (warn), and `console.log` (debug/info).
 *
 * @example
 * ```ts
 * state.sinks.push(consoleSink());
 * ```
 */
export function consoleSink(): LogSink {
  throw new Error("not implemented");
}

/**
 * Install mode-selected default sinks at onInit. The in-memory trace is always
 * on (`state.entries`); the console sink is added only in dev/production.
 *
 * @param _ctx - Core plugin context (`{ config, state }`).
 * @param _ctx.config - Resolved log config (`{ mode }`).
 * @param _ctx.state - Mutable log state (`{ entries, sinks }`).
 * @example
 * ```ts
 * // mode "dev" -> state.sinks === [consoleSink()]; mode "test" -> state.sinks === []
 * ```
 */
export function installDefaultSinks(_ctx: {
  readonly config: Readonly<LogConfig>;
  readonly state: LogState;
}): void {
  throw new Error("not implemented");
}
