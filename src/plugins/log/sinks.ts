/**
 * @file log plugin — output sink factories.
 *
 * Houses the built-in console sink and the onInit sink-installation helper. New
 * sinks (file/JSON) can be added here later without any change to the log API
 * (the `LogSink` seam).
 */
import type { LogConfig, LogLevel, LogSink, LogState } from "./types";

/** Severity rank for threshold comparison (higher = more severe). */
const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

/**
 * Build the console sink: routes entries by channel — `error` → `console.error`,
 * `warn` → `console.warn`, and `debug`/`info` → `console.log`. The full entry
 * object is forwarded so the console serializes its `event` and `data`. Entries
 * below `minLevel` are dropped (the in-memory trace still records everything).
 *
 * @param minLevel - Lowest severity to print. Defaults to `"debug"` (print all).
 * @returns A {@link LogSink} that writes to the matching `console` channel.
 * @example
 * ```ts
 * state.sinks.push(consoleSink("info")); // suppress debug spam
 * ```
 */
export function consoleSink(minLevel: LogLevel = "debug"): LogSink {
  const threshold = LEVEL_RANK[minLevel];
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
      if (LEVEL_RANK[entry.level] < threshold) return;
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
 * on (`state.entries`); the console sink is added only in dev/production. `dev`
 * prints everything (debug+); `production` prints `info`+ only, so the per-phase
 * `debug` events (build:bundle, build:pages, …) don't spam a prod build. Both
 * modes still record all levels in the in-memory trace.
 *
 * @param ctx - Core plugin context (`{ config, state }`).
 * @param ctx.config - Resolved log config (`{ mode }`).
 * @param ctx.state - Mutable log state (`{ entries, sinks }`).
 * @example
 * ```ts
 * // "dev" -> [consoleSink("debug")]; "production" -> [consoleSink("info")]; "test"/"silent" -> []
 * ```
 */
export function installDefaultSinks(ctx: {
  readonly config: Readonly<LogConfig>;
  readonly state: LogState;
}): void {
  if (ctx.config.mode === "dev") {
    ctx.state.sinks.push(consoleSink("debug"));
  } else if (ctx.config.mode === "production") {
    ctx.state.sinks.push(consoleSink("info"));
  }
}
