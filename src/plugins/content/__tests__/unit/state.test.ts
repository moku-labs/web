import { describe, expect, it } from "vitest";
import { createContentState } from "../../state";
import type { Config } from "../../types";

const config: Config = { providers: [] };

describe("content/state", () => {
  it("starts with an empty article cache", () => {
    const state = createContentState({ global: {}, config });
    expect(state.articles).toBeInstanceOf(Map);
    expect(state.articles.size).toBe(0);
  });

  it("returns a fresh state object on each call (no shared containers)", () => {
    const a = createContentState({ global: {}, config });
    const b = createContentState({ global: {}, config });
    expect(a.articles).not.toBe(b.articles);
  });
});
