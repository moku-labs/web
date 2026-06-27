import { describe, expect, it } from "vitest";
import { defaultCollectionConfig } from "../../config";
import { createCollectionState } from "../../state";

describe("createCollectionState()", () => {
  it("starts with a null lastWrite and an empty cache", () => {
    const state = createCollectionState({ global: {}, config: defaultCollectionConfig });
    expect(state.lastWrite).toBeNull();
    expect(state.cache).toBeInstanceOf(Map);
    expect(state.cache.size).toBe(0);
    expect(Object.keys(state).toSorted()).toEqual(["cache", "lastWrite"]);
  });

  it("returns a fresh object (and a fresh Map) on each call", () => {
    const a = createCollectionState({ global: {}, config: defaultCollectionConfig });
    const b = createCollectionState({ global: {}, config: defaultCollectionConfig });
    expect(a).not.toBe(b);
    expect(a.cache).not.toBe(b.cache);
  });
});
