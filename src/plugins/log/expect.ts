/**
 * @file log plugin — event-trace assertion DSL.
 *
 * Implements the fluent `expect()` chain (live-read), the subset-equality
 * matcher, and the named assertion-error class.
 */
import type { ExpectChain, LogEntry } from "./types";

/**
 * Named error thrown by `expect()` assertions when a trace condition fails.
 *
 * @example
 * ```ts
 * throw new LogExpectAssertionError("missing event build:complete");
 * ```
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
 * Tests whether `actual` is an array that recursively matches every element of
 * the `partial` array (element-wise, with equal length).
 *
 * @param actual - The value to test against (must be an array of equal length).
 * @param partial - The expected partial array shape.
 * @returns `true` when `actual` is an equal-length array matching `partial` element-wise.
 * @example
 * ```ts
 * matchesPartialArray([1, 2], [1, 2]); // true
 * matchesPartialArray([1], [1, 2]); // false (length mismatch)
 * ```
 */
function matchesPartialArray(actual: unknown, partial: readonly unknown[]): boolean {
  // Guard: only an array of identical length can be a subset.
  if (!Array.isArray(actual) || actual.length !== partial.length) {
    return false;
  }

  // Every expected element must recursively match the same position.
  return partial.every((value, index) => matchesPartial(actual[index], value));
}

/**
 * Tests whether `actual` is a plain object in which every `partial` key
 * recursively matches (extra `actual` keys are ignored).
 *
 * @param actual - The value to test against (must be a plain object).
 * @param partial - The expected partial object shape.
 * @returns `true` when every `partial` key exists in `actual` and matches recursively.
 * @example
 * ```ts
 * matchesPartialObject({ a: 1, b: 2 }, { a: 1 }); // true
 * matchesPartialObject({ a: 1 }, { b: 1 }); // false (missing key)
 * ```
 */
function matchesPartialObject(actual: unknown, partial: Record<string, unknown>): boolean {
  // Guard: only a plain object can satisfy an object subset.
  if (!isPlainObject(actual)) {
    return false;
  }

  // Every expected key must be present and recursively match.
  return Object.keys(partial).every(
    key => key in actual && matchesPartial(actual[key], partial[key])
  );
}

/**
 * Subset-equality matcher: is `partial` a recursive subset of `actual`?
 *
 * Fast path via `Object.is` (covers identical primitives/references and
 * `null`/`NaN`); primitives compare with `Object.is`; arrays match element-wise
 * with equal length; plain objects require every `partial` key to recursively
 * match (extra `actual` keys ignored).
 *
 * @param actual - The value to test against (typically `entry.data`).
 * @param partial - The expected partial shape.
 * @returns `true` when `partial` is a recursive subset of `actual`.
 * @example
 * ```ts
 * matchesPartial({ a: 1, b: 2 }, { a: 1 }); // true
 * matchesPartial([1, 2], [1]); // false (length mismatch)
 * ```
 */
export function matchesPartial(actual: unknown, partial: unknown): boolean {
  // Fast path: identical primitives/references (also covers `null`/`NaN`).
  if (Object.is(actual, partial)) {
    return true;
  }

  // Array partial: delegate to element-wise subset matching.
  if (Array.isArray(partial)) {
    return matchesPartialArray(actual, partial);
  }

  // Object partial: delegate to key-wise recursive subset matching.
  if (isPlainObject(partial)) {
    return matchesPartialObject(actual, partial);
  }

  // Primitive (or array-vs-non-array) `partial` that is not `Object.is`-equal.
  return false;
}

/**
 * Tests whether an entry matches `event` and (when provided) `partial`.
 *
 * @param entry - The candidate trace entry.
 * @param event - Required event name.
 * @param partial - Optional partial data shape (subset-matched against `entry.data`).
 * @returns `true` when the entry matches the event and optional partial.
 * @example
 * ```ts
 * entryMatches({ level: "info", event: "a", data: { x: 1 }, ts: 0 }, "a", { x: 1 }); // true
 * ```
 */
function entryMatches(entry: LogEntry, event: string, partial?: Record<string, unknown>): boolean {
  if (entry.event !== event) {
    return false;
  }
  return partial === undefined ? true : matchesPartial(entry.data, partial);
}

/**
 * Render a `partial` for an error message, prefixed with a space when present.
 *
 * @param partial - Optional partial data shape.
 * @returns A ` matching <json>` suffix, or an empty string when absent.
 * @example
 * ```ts
 * describePartial({ ok: true }); // ' matching {"ok":true}'
 * ```
 */
function describePartial(partial?: Record<string, unknown>): string {
  return partial === undefined ? "" : ` matching ${JSON.stringify(partial)}`;
}

/**
 * Find the first entry with `event` at or after `startIndex`, scanning forward.
 *
 * @param entries - The trace array to scan.
 * @param event - Event name to find.
 * @param startIndex - Index to begin scanning from (inclusive).
 * @returns The index of the first match, or `-1` when none exists from `startIndex` on.
 * @example
 * ```ts
 * findEventAtOrAfter([{ event: "a" }, { event: "b" }] as LogEntry[], "b", 0); // 1
 * ```
 */
function findEventAtOrAfter(
  entries: readonly LogEntry[],
  event: string,
  startIndex: number
): number {
  for (let index = startIndex; index < entries.length; index++) {
    if (entries[index]?.event === event) {
      return index;
    }
  }
  return -1;
}

/**
 * Create a fluent assertion chain bound to the live `entries` array. Each method
 * reads `entries` at call time, so assertions reflect later logging.
 *
 * @param entries - The live trace array (read on each assertion call).
 * @returns A fresh {@link ExpectChain} backed by `entries`.
 * @example
 * ```ts
 * createExpectChain(state.entries).toHaveEvent("build:complete");
 * ```
 */
export function createExpectChain(entries: readonly LogEntry[]): ExpectChain {
  const chain: ExpectChain = {
    /**
     * Assert at least one entry has `event`, optionally matching `partial`.
     *
     * @param event - Event name to find.
     * @param partial - Optional partial data shape (subset-matched).
     * @returns The same chain for chaining.
     * @throws {LogExpectAssertionError} When no matching entry exists.
     * @example
     * ```ts
     * chain.toHaveEvent("build:phase", { status: "start" });
     * ```
     */
    toHaveEvent(event: string, partial?: Record<string, unknown>): ExpectChain {
      const found = entries.some(entry => entryMatches(entry, event, partial));
      if (!found) {
        throw new LogExpectAssertionError(
          `Expected trace to contain event "${event}"${describePartial(partial)}, but none was found.`
        );
      }
      return chain;
    },
    /**
     * Assert all of `events` appear in the trace in the given relative order.
     *
     * @param events - Ordered list of event names (gaps allowed).
     * @returns The same chain for chaining.
     * @throws {LogExpectAssertionError} When the ordering cannot be satisfied.
     * @example
     * ```ts
     * chain.toHaveEventInOrder(["build:phase", "build:complete"]);
     * ```
     */
    toHaveEventInOrder(events: string[]): ExpectChain {
      // Walk the trace once, advancing the cursor past each matched event so the
      // next search can only succeed strictly later — enforcing relative order.
      let cursor = 0;
      for (const [position, event] of events.entries()) {
        const matchIndex = findEventAtOrAfter(entries, event, cursor);

        if (matchIndex === -1) {
          throw new LogExpectAssertionError(
            `Expected events in order ${JSON.stringify(events)}, but "${event}" (index ${position}) was not found at or after position ${cursor}.`
          );
        }

        cursor = matchIndex + 1;
      }

      return chain;
    },
    /**
     * Assert NO entry has `event` (optionally narrowed by `partial`).
     *
     * @param event - Event name that must be absent.
     * @param partial - Optional partial data shape; only matching entries violate.
     * @returns The same chain for chaining.
     * @throws {LogExpectAssertionError} When a matching entry exists.
     * @example
     * ```ts
     * chain.toNotHaveEvent("deploy:failed");
     * ```
     */
    toNotHaveEvent(event: string, partial?: Record<string, unknown>): ExpectChain {
      const offending = entries.findIndex(entry => entryMatches(entry, event, partial));
      if (offending !== -1) {
        throw new LogExpectAssertionError(
          `Expected trace to NOT contain event "${event}"${describePartial(partial)}, but found one at index ${offending}.`
        );
      }
      return chain;
    }
  };
  return chain;
}
