import { describe, it } from "vitest";

describe("log expect() matcher, ordering, and negatives", () => {
  it.todo("toHaveEvent passes with and without partial; extra actual keys ignored (subset)");
  it.todo("primitive Object.is semantics (incl. NaN matches NaN)");
  it.todo("recursive nested object match and element-wise array match (length mismatch fails)");
  it.todo("toHaveEventInOrder passes for correct order with gaps, throws on missing/out-of-order");
  it.todo("toNotHaveEvent passes when absent, throws on matching (incl. partial) entry");
  it.todo("all failures throw LogExpectAssertionError");
});
