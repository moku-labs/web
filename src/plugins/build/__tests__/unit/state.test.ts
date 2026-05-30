import { describe, expect, it } from "vitest";
import { createState } from "../../state";
import type { Config } from "../../types";

const CONFIG: Config = {
  outDir: "./dist",
  minify: true,
  feeds: true,
  sitemap: true,
  images: true,
  ogImage: false
};

describe("build/state", () => {
  it("createState initializes per-run caches + OG hash cache", () => {
    const state = createState({ global: {}, config: CONFIG });
    expect(state.config).toBe(CONFIG);
    expect(state.manifest).toBeNull();
    expect(state.runId).toBeNull();
    expect(state.buildCache).toBeInstanceOf(Map);
    expect(state.buildCache.size).toBe(0);
    expect(state.ogImageHashCache).toBeInstanceOf(Map);
    expect(state.ogImageHashCache.size).toBe(0);
  });

  it("state caches reset per run (fresh map instances per createState call)", () => {
    const a = createState({ global: {}, config: CONFIG });
    a.buildCache.set("content", []);
    a.ogImageHashCache.set("x", "hash");
    const b = createState({ global: {}, config: CONFIG });
    expect(b.buildCache.size).toBe(0);
    expect(b.ogImageHashCache.size).toBe(0);
    expect(b.buildCache).not.toBe(a.buildCache);
  });
});
