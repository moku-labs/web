import { describe, expect, it } from "vitest";
import { defaultDataConfig } from "../../config";
import { createDataState } from "../../state";

describe("createDataState()", () => {
  it("starts with a null lastEmit and a null manifest cache", () => {
    const state = createDataState({ global: {}, config: defaultDataConfig });
    expect(state.lastEmit).toBeNull();
    expect(state.manifest).toBeNull();
    expect(Object.keys(state).toSorted()).toEqual(["lastEmit", "manifest"]);
  });

  it("returns a fresh object on each call (no shared reference)", () => {
    const a = createDataState({ global: {}, config: defaultDataConfig });
    const b = createDataState({ global: {}, config: defaultDataConfig });
    expect(a).not.toBe(b);
  });
});
