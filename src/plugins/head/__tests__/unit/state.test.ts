import { describe, expect, it } from "vitest";
import { createState } from "../../state";

describe("head state", () => {
  it("initializes the defaults slot to null", () => {
    const state = createState({ global: {}, config: {} });
    expect(state.defaults).toBeNull();
    expect(Object.keys(state)).toEqual(["defaults"]);
  });

  it("returns a fresh object each call (no shared mutable state)", () => {
    const a = createState({ global: {}, config: {} });
    const b = createState({ global: {}, config: {} });
    expect(a).not.toBe(b);
  });
});
