import { describe, expect, it } from "vitest";
import { defaultDataConfig } from "../../config";
import { createDataState } from "../../state";

describe("createDataState()", () => {
  it("starts with a null lastWrite and an empty cache", () => {
    const state = createDataState({ global: {}, config: defaultDataConfig });
    expect(state.lastWrite).toBeNull();
    expect(state.cache).toBeInstanceOf(Map);
    expect(state.cache.size).toBe(0);
    expect(Object.keys(state).toSorted()).toEqual(["cache", "lastWrite"]);
  });

  it("returns a fresh object (and a fresh Map) on each call", () => {
    const a = createDataState({ global: {}, config: defaultDataConfig });
    const b = createDataState({ global: {}, config: defaultDataConfig });
    expect(a).not.toBe(b);
    expect(a.cache).not.toBe(b.cache);
  });
});
