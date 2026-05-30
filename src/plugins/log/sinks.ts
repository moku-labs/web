/**
 * @file log plugin — output sink factories.
 *
 * Houses the built-in console sink and the onInit sink-installation helper. New
 * sinks (file/JSON) can be added here later without any change to the log API
 * (the `LogSink` seam).
 */
import type { LogConfig, LogSink, LogState } from "./types";

/**
 * Build the console sink: routes entries by channel — `error` → `console.error`,
 * `warn` → `console.warn`, and `debug`/`info` → `console.log`. The full entry
 * object is forwarded so the console serializes its `event` and `data`.
 *
 * @returns A {@link LogSink} that writes to the matching `console` channel.
 * @example
 * ```ts
 * state.sinks.push(consoleSink());
 * ```
 */
export function consoleSink(): LogSink {
  return {
    /**
     * Route a single entry to the console channel matching its level.
     *
     * @param entry - The entry to emit.
     * @example
     * ```ts
     * sink.write({ level: "warn", event: "build:skip", ts: Date.now() });
     * ```
     */
    write(entry) {
      if (entry.level === "error") {
        console.error(entry);
      } else if (entry.level === "warn") {
        console.warn(entry);
      } else {
        // biome-ignore lint/suspicious/noConsole: spec routes debug/info to console.log.
        console.log(entry);
      }
    }
  };
}

/**
 * Install mode-selected default sinks at onInit. The in-memory trace is always
 * on (`state.entries`); the console sink is added only in dev/production.
 *
 * @param ctx - Core plugin context (`{ config, state }`).
 * @param ctx.config - Resolved log config (`{ mode }`).
 * @param ctx.state - Mutable log state (`{ entries, sinks }`).
 * @example
 * ```ts
 * // mode "dev" -> state.sinks === [consoleSink()]; mode "test" -> state.sinks === []
 * ```
 */
export function installDefaultSinks(ctx: {
  readonly config: Readonly<LogConfig>;
  readonly state: LogState;
}): void {
  if (ctx.config.mode === "dev" || ctx.config.mode === "production") {
    ctx.state.sinks.push(consoleSink());
  }
}
