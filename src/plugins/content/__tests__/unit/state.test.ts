import { describe, expect, it } from "vitest";
import { createContentState } from "../../state";
import type { Config } from "../../types";

const config: Config = {
  contentDir: "./src/content",
  trustedContent: false,
  extraRemarkPlugins: [],
  extraRehypePlugins: [],
  shikiTheme: "github-dark"
};

describe("content/state", () => {
  it("starts with processor=null, empty articles, slugs=null, empty dirtyPaths", () => {
    const state = createContentState({ global: {}, config });
    expect(state.processor).toBeNull();
    expect(state.articles).toBeInstanceOf(Map);
    expect(state.articles.size).toBe(0);
    expect(state.slugs).toBeNull();
    expect(state.dirtyPaths).toBeInstanceOf(Set);
    expect(state.dirtyPaths.size).toBe(0);
  });

  it("returns a fresh state object on each call (no shared containers)", () => {
    const a = createContentState({ global: {}, config });
    const b = createContentState({ global: {}, config });
    expect(a.articles).not.toBe(b.articles);
    expect(a.dirtyPaths).not.toBe(b.dirtyPaths);
  });
});
