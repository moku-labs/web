/**
 * @file log plugin — type definitions skeleton.
 *
 * Core-plugin type surface: config, state, public API, and the supporting
 * value/sink/assertion-chain types. These types are inferred onto the plugin
 * via state.ts / api.ts; index.ts passes NO explicit generics.
 */

/**
 * Runtime mode for the log plugin. Selects which default sinks are installed at
 * onInit. The in-memory trace sink is ALWAYS installed regardless of mode.
 *
 * - "test"       — no console sink (keeps test output clean); trace only.
 * - "silent"     — no console sink (explicit quiet); trace only.
 * - "dev"        — console sink + trace.
 * - "production" — console sink + trace.
 */
export type LogConfig = {
  /** Sink-selection mode. Defaults to `production`. */
  mode: "test" | "dev" | "production" | "silent";
};

/** Severity level for a log entry. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * A single recorded log entry.
 */
export type LogEntry = {
  /** Severity level. */
  level: LogLevel;
  /** Event identifier (free-form string; convention: `domain:action`). */
  event: string;
  /** Optional structured payload associated with the event. */
  data?: unknown;
  /** Capture timestamp in epoch milliseconds (`Date.now()` at append time). */
  ts: number;
  /** Optional originating plugin name. Reserved for future enrichment. */
  plugin?: string;
};

/**
 * Pluggable output target. Implement this to add console/file/JSON/etc. sinks
 * WITHOUT changing the log API. Each logged entry is passed to `write` once,
 * in registration order.
 */
export type LogSink = {
  /**
   * Write a single entry to this sink.
   *
   * @param entry - The entry to emit.
   */
  write(entry: LogEntry): void;
};

/**
 * Fluent event-trace assertion chain. Reads the live entries array on each call,
 * so assertions reflect the trace state at call time (not chain-creation time).
 * Every method returns the same chain for fluent chaining; assertion failures throw.
 */
export type ExpectChain = {
  /**
   * Assert at least one entry has `event`, optionally matching `partial` (subset match).
   *
   * @param event - Event name to find.
   * @param partial - Optional partial data shape (subset-matched against `entry.data`).
   * @returns The same chain for chaining.
   * @throws {Error} `LogExpectAssertionError` when no matching entry exists.
   */
  toHaveEvent(event: string, partial?: Record<string, unknown>): ExpectChain;
  /**
   * Assert all of `events` appear in the trace in the given relative order
   * (gaps allowed; later events must occur after earlier ones).
   *
   * @param events - Ordered list of event names.
   * @returns The same chain for chaining.
   * @throws {Error} `LogExpectAssertionError` when the ordering cannot be satisfied.
   */
  toHaveEventInOrder(events: string[]): ExpectChain;
  /**
   * Assert NO entry has `event` (optionally narrowed by `partial`).
   *
   * @param event - Event name that must be absent.
   * @param partial - Optional partial data shape; only matching entries violate the assertion.
   * @returns The same chain for chaining.
   * @throws {Error} `LogExpectAssertionError` when a matching entry exists.
   */
  toNotHaveEvent(event: string, partial?: Record<string, unknown>): ExpectChain;
};

/**
 * Internal mutable state for the log plugin. Created fresh per createApp construction.
 */
export type LogState = {
  /** Append-only ordered trace of every logged entry (the in-memory trace sink's backing store). */
  entries: LogEntry[];
  /** Registered output sinks. Each entry is written to every sink in order. */
  sinks: LogSink[];
};

/** Public log API injected as `ctx.log` on every regular plugin and exposed as `app.log`. */
export type LogApi = {
  /**
   * Append an `info` entry and fan it out to every sink.
   *
   * @param event - Event identifier (convention: `domain:action`).
   * @param data - Optional structured payload.
   */
  info(event: string, data?: unknown): void;
  /**
   * Append a `debug` entry and fan it out to every sink.
   *
   * @param event - Event identifier (convention: `domain:action`).
   * @param data - Optional structured payload.
   */
  debug(event: string, data?: unknown): void;
  /**
   * Append a `warn` entry and fan it out to every sink.
   *
   * @param event - Event identifier (convention: `domain:action`).
   * @param data - Optional structured payload.
   */
  warn(event: string, data?: unknown): void;
  /**
   * Append an `error` entry. When `error` is provided, its `message`/`stack` are
   * merged into `data` under an `error` key; otherwise `data` is recorded as-is.
   *
   * @param event - Event identifier (convention: `domain:action`).
   * @param data - Optional structured payload.
   * @param error - Optional originating Error to merge into `data`.
   */
  error(event: string, data?: unknown, error?: Error): void;
  /**
   * Return a frozen snapshot of the entries recorded so far (a fresh copy).
   *
   * @returns A readonly, frozen copy of the recorded entries.
   */
  trace(): readonly LogEntry[];
  /**
   * Return a fluent assertion chain bound to the live entries array.
   *
   * @returns A fresh {@link ExpectChain}.
   */
  expect(): ExpectChain;
  /**
   * Register an additional output sink at runtime.
   *
   * @param sink - The sink to add to the fan-out list.
   */
  addSink(sink: LogSink): void;
  /** Clear all recorded entries while keeping registered sinks. */
  reset(): void;
};
