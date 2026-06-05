/**
 * @file log plugin — API factory.
 *
 * Builds the `LogApi` over the plugin's `{ config, state }` core context:
 * the leveled loggers (via a shared `append`), the frozen `trace()` snapshot,
 * the live `expect()` chain, `addSink`, and `reset`.
 */
import { createExpectChain } from "./expect";
import type {
  ExpectChain,
  LogApi,
  LogConfig,
  LogEntry,
  LogLevel,
  LogSink,
  LogState
} from "./types";

/** Core-plugin context surface available to the log API factory. */
type LogContext = {
  readonly config: Readonly<LogConfig>;
  readonly state: LogState;
};

/**
 * Append a new entry to the trace and fan it out to every sink in order.
 *
 * @param state - The mutable log state to append to.
 * @param level - Severity level for the entry.
 * @param event - Event identifier.
 * @param data - Optional structured payload.
 * @example
 * ```ts
 * append(state, "info", "content:ready", { count: 12 });
 * ```
 */
function append(state: LogState, level: LogLevel, event: string, data?: unknown): void {
  const entry: LogEntry = { level, event, data, ts: Date.now() };
  state.entries.push(entry);
  for (const sink of state.sinks) {
    sink.write(entry);
  }
}

/**
 * Tests whether a value is a non-null, non-array plain object.
 *
 * @param value - The value to test.
 * @returns `true` when `value` is a non-null object that is not an array.
 * @example
 * ```ts
 * isPlainObject({ a: 1 }); // true
 * isPlainObject([1]); // false
 * ```
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge an `Error`'s `message`/`stack` into `data` under an `error` key. The
 * `error` field is always preserved; only a plain object `data` contributes its
 * keys. Non-plain-object `data` (arrays and primitives) is replaced by `{}` —
 * its original value is not retained — so the merge target is always a record.
 *
 * @param data - Original payload (any shape).
 * @param error - The originating error to merge.
 * @returns A new object carrying any plain-object keys plus the `error` field.
 * @example
 * ```ts
 * mergeError({ target: "cf" }, new Error("boom"));
 * // { target: "cf", error: { message: "boom", stack: "..." } }
 * ```
 */
function mergeError(data: unknown, error: Error): Record<string, unknown> {
  const base = isPlainObject(data) ? data : {};
  return { ...base, error: { message: error.message, stack: error.stack } };
}

/**
 * Create the log plugin API surface injected as `ctx.log` / `app.log`.
 *
 * @param ctx - Core plugin context (`{ config, state }`).
 * @returns The {@link LogApi} bound to `ctx.state`.
 * @example
 * ```ts
 * const log = createLogApi(ctx);
 * log.info("content:ready", { articleCount: 12 });
 * ```
 */
export function createLogApi(ctx: LogContext): LogApi {
  const { state } = ctx;
  return {
    /**
     * Append an `info` entry and fan it out to every sink.
     *
     * @param event - Event identifier (convention: `domain:action`).
     * @param data - Optional structured payload.
     * @example
     * ```ts
     * log.info("content:ready", { count: 12 });
     * ```
     */
    info(event: string, data?: unknown): void {
      append(state, "info", event, data);
    },
    /**
     * Append a `debug` entry and fan it out to every sink.
     *
     * @param event - Event identifier (convention: `domain:action`).
     * @param data - Optional structured payload.
     * @example
     * ```ts
     * log.debug("router:match", { path: "/blog/" });
     * ```
     */
    debug(event: string, data?: unknown): void {
      append(state, "debug", event, data);
    },
    /**
     * Append a `warn` entry and fan it out to every sink.
     *
     * @param event - Event identifier (convention: `domain:action`).
     * @param data - Optional structured payload.
     * @example
     * ```ts
     * log.warn("build:skip", { reason: "no sitemap" });
     * ```
     */
    warn(event: string, data?: unknown): void {
      append(state, "warn", event, data);
    },
    /**
     * Append an `error` entry. When `error` is provided, its `message`/`stack`
     * are merged into `data` under an `error` key (existing keys preserved);
     * otherwise `data` is recorded as-is.
     *
     * @param event - Event identifier (convention: `domain:action`).
     * @param data - Optional structured payload.
     * @param error - Optional originating Error to merge into `data`.
     * @example
     * ```ts
     * log.error("deploy:failed", { target: "cf" }, err);
     * ```
     */
    error(event: string, data?: unknown, error?: Error): void {
      append(state, "error", event, error === undefined ? data : mergeError(data, error));
    },
    /**
     * Return a frozen snapshot (fresh copy) of the entries recorded so far.
     *
     * @returns A readonly, frozen copy of the recorded entries.
     * @example
     * ```ts
     * const entries = log.trace();
     * ```
     */
    trace(): readonly LogEntry[] {
      return Object.freeze([...state.entries]);
    },
    /**
     * Return a fluent assertion chain bound to the live entries array.
     *
     * @returns A fresh {@link ExpectChain} reading `state.entries` live.
     * @example
     * ```ts
     * log.expect().toHaveEvent("build:complete");
     * ```
     */
    expect(): ExpectChain {
      return createExpectChain(state.entries);
    },
    /**
     * Register an additional output sink at runtime.
     *
     * @param sink - The sink to add to the fan-out list.
     * @example
     * ```ts
     * log.addSink({ write: (e) => stream.write(JSON.stringify(e)) });
     * ```
     */
    addSink(sink: LogSink): void {
      state.sinks.push(sink);
    },
    /**
     * Clear all recorded entries while keeping registered sinks.
     *
     * @example
     * ```ts
     * log.reset();
     * ```
     */
    reset(): void {
      state.entries.length = 0;
    }
  };
}
