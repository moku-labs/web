/**
 * @file log plugin — event-trace assertion DSL skeleton.
 *
 * Implements the fluent `expect()` chain (live-read), the subset-equality
 * matcher, and the named assertion-error class.
 */
import type { ExpectChain, LogEntry } from "./types";

/**
 * Named error thrown by `expect()` assertions when a trace condition fails.
 */
export class LogExpectAssertionError extends Error {
  /**
   * Construct a new assertion error with a descriptive failure message.
   *
   * @param message - Descriptive failure message (event name, partial, index).
   * @example
   * ```ts
   * throw new LogExpectAssertionError("missing event build:complete");
   * ```
   */
  constructor(message: string) {
    super(message);
    this.name = "LogExpectAssertionError";
  }
}

/**
 * Subset-equality matcher: is `partial` a recursive subset of `actual`?
 *
 * @param _actual - The value to test against (typically `entry.data`).
 * @param _partial - The expected partial shape.
 * @example
 * ```ts
 * matchesPartial({ a: 1, b: 2 }, { a: 1 }); // true
 * ```
 */
export function matchesPartial(_actual: unknown, _partial: unknown): boolean {
  throw new Error("not implemented");
}

/**
 * Create a fluent assertion chain bound to the live `entries` array.
 *
 * @param _entries - The live trace array (read on each assertion call).
 * @example
 * ```ts
 * createExpectChain(state.entries).toHaveEvent("build:complete");
 * ```
 */
export function createExpectChain(_entries: readonly LogEntry[]): ExpectChain {
  throw new Error("not implemented");
}
