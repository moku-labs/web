import { describe, expect, it } from "vitest";
import { defaultDataConfig } from "../../config";
import { createDataState } from "../../state";

describe("createDataState()", () => {
  it("starts with a null lastWrite, an empty cache and no pending fetch", () => {
    const state = createDataState({ global: {}, config: defaultDataConfig });
    expect(state.lastWrite).toBeNull();
    expect(state.cache).toBeInstanceOf(Map);
    expect(state.cache.size).toBe(0);
    expect(state.pending).toBeInstanceOf(Map);
    expect(state.pending.size).toBe(0);
    expect(state.bundle).toBeNull();
    expect(state.cancelPreload).toBeNull();
    expect(Object.keys(state).toSorted()).toEqual([
      "bundle",
      "cache",
      "cancelPreload",
      "lastWrite",
      "pending"
    ]);
  });

  it("returns a fresh object (and a fresh Map) on each call", () => {
    const a = createDataState({ global: {}, config: defaultDataConfig });
    const b = createDataState({ global: {}, config: defaultDataConfig });
    expect(a).not.toBe(b);
    expect(a.cache).not.toBe(b.cache);
    expect(a.pending).not.toBe(b.pending);
  });
});
