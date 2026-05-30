import { describe, expect, it } from "vitest";
import { createExpectChain, LogExpectAssertionError, matchesPartial } from "../../expect";
import type { LogEntry } from "../../types";

/**
 * Build a trace array from level-less event/data pairs.
 *
 * @param pairs - Event-name / data tuples in order.
 * @returns A live entries array.
 */
function trace(...pairs: Array<[string, unknown?]>): LogEntry[] {
  return pairs.map(([event, data], i) => ({ level: "info", event, data, ts: i }));
}

describe("matchesPartial subset-equality", () => {
  it("matches a recursive subset of a plain object, ignoring extra actual keys", () => {
    expect(matchesPartial({ a: 1, b: 2, c: 3 }, { a: 1, b: 2 })).toBe(true);
    expect(matchesPartial({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("compares primitives with Object.is (NaN matches NaN; +0/-0 distinguished)", () => {
    expect(matchesPartial(Number.NaN, Number.NaN)).toBe(true);
    expect(matchesPartial(0, 0)).toBe(true);
    expect(matchesPartial(0, -0)).toBe(false);
    expect(matchesPartial("x", "x")).toBe(true);
    expect(matchesPartial("x", "y")).toBe(false);
  });

  it("matches nested objects recursively", () => {
    expect(matchesPartial({ a: { b: { c: 1, d: 2 } } }, { a: { b: { c: 1 } } })).toBe(true);
    expect(matchesPartial({ a: { b: { c: 1 } } }, { a: { b: { c: 9 } } })).toBe(false);
  });

  it("matches arrays element-wise; length mismatch fails", () => {
    expect(matchesPartial([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(matchesPartial([1, 2, 3], [1, 2])).toBe(false);
    expect(matchesPartial([{ a: 1, b: 2 }], [{ a: 1 }])).toBe(true);
  });

  it("guards null and array/object type mismatches", () => {
    // eslint-disable-next-line unicorn/no-null -- null is the value under test for the null guard
    expect(matchesPartial(null, null)).toBe(true);
    // eslint-disable-next-line unicorn/no-null -- null is the value under test for the null guard
    expect(matchesPartial(null, { a: 1 })).toBe(false);
    // eslint-disable-next-line unicorn/no-null -- null is the value under test for the null guard
    expect(matchesPartial({ a: 1 }, null)).toBe(false);
    expect(matchesPartial([1], { 0: 1 })).toBe(false);
    expect(matchesPartial({ 0: 1 }, [1])).toBe(false);
  });
});

describe("log expect() matcher, ordering, and negatives", () => {
  it("toHaveEvent passes with and without partial; extra actual keys ignored (subset)", () => {
    const chain = createExpectChain(trace(["build:phase", { phase: "content", extra: 1 }]));
    expect(() => chain.toHaveEvent("build:phase")).not.toThrow();
    expect(() => chain.toHaveEvent("build:phase", { phase: "content" })).not.toThrow();
    expect(() => chain.toHaveEvent("missing:event")).toThrow(LogExpectAssertionError);
    expect(() => chain.toHaveEvent("build:phase", { phase: "wrong" })).toThrow(
      LogExpectAssertionError
    );
  });

  it("primitive Object.is semantics inside partial (NaN matches NaN)", () => {
    const chain = createExpectChain(trace(["m:nan", { v: Number.NaN }]));
    expect(() => chain.toHaveEvent("m:nan", { v: Number.NaN })).not.toThrow();
  });

  it("toHaveEvent returns the same chain for fluent chaining", () => {
    const chain = createExpectChain(trace(["a:one"], ["a:two"]));
    expect(chain.toHaveEvent("a:one")).toBe(chain);
  });

  it("toHaveEventInOrder passes for correct order with gaps, throws on out-of-order", () => {
    const chain = createExpectChain(trace(["a"], ["x"], ["b"], ["c"]));
    expect(() => chain.toHaveEventInOrder(["a", "b", "c"])).not.toThrow();
    expect(() => chain.toHaveEventInOrder(["c", "a"])).toThrow(LogExpectAssertionError);
    expect(() => chain.toHaveEventInOrder(["a", "missing"])).toThrow(LogExpectAssertionError);
  });

  it("toNotHaveEvent passes when absent, throws on matching (incl. partial) entry", () => {
    const chain = createExpectChain(trace(["present", { ok: true }]));
    expect(() => chain.toNotHaveEvent("absent")).not.toThrow();
    expect(() => chain.toNotHaveEvent("present")).toThrow(LogExpectAssertionError);
    expect(() => chain.toNotHaveEvent("present", { ok: false })).not.toThrow();
    expect(() => chain.toNotHaveEvent("present", { ok: true })).toThrow(LogExpectAssertionError);
  });

  it("failure messages include event name and stringified partial", () => {
    const chain = createExpectChain(trace());
    try {
      chain.toHaveEvent("build:complete", { status: "done" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LogExpectAssertionError);
      const message = (error as Error).message;
      expect(message).toContain("build:complete");
      expect(message).toContain(JSON.stringify({ status: "done" }));
    }
  });
});
