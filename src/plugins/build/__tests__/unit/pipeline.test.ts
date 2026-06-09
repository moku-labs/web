import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTENT_CACHE_KEY } from "../../phases/content";
import { generateOgImages } from "../../phases/og-images";
import { planIncrementalRebuild, resetRun } from "../../pipeline";
import { makeArticle, makeCtx } from "../helpers";

describe("build/pipeline planIncrementalRebuild", () => {
  it("a full build (no/empty changed set) reuses nothing", () => {
    const expected = { contentChanged: [], contentReuse: false, renderReuse: false };
    expect(planIncrementalRebuild(undefined)).toEqual(expected);
    expect(planIncrementalRebuild([])).toEqual(expected);
  });

  it("a Markdown-only change reuses content + renders and lists the changed md", () => {
    const plan = planIncrementalRebuild(["content/intro/en.md", "content/about/en.md"]);
    expect(plan).toEqual({
      contentChanged: ["content/intro/en.md", "content/about/en.md"],
      contentReuse: true,
      renderReuse: true
    });
  });

  it("a CSS-only change reuses content + renders (no markdown to invalidate)", () => {
    expect(planIncrementalRebuild(["src/client/styles.css"])).toEqual({
      contentChanged: [],
      contentReuse: true,
      renderReuse: true
    });
  });

  it("a code change reuses content but busts the render cache (code can change any page)", () => {
    expect(planIncrementalRebuild(["src/components/Card.tsx", "content/intro/en.md"])).toEqual({
      contentChanged: ["content/intro/en.md"],
      contentReuse: true,
      renderReuse: false
    });
  });

  it("an unclassifiable change (a bare directory) forces a full rebuild — correctness over speed", () => {
    expect(planIncrementalRebuild(["content"])).toEqual({
      contentChanged: [],
      contentReuse: false,
      renderReuse: false
    });
  });
});

describe("build/pipeline resetRun", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "build-pipeline-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("a clean run clears the OG hash cache (the outDir wipe deletes the PNGs it indexes)", () => {
    const ctx = makeCtx({});
    ctx.state.ogImageHashCache.set("hello", "stale-hash");

    resetRun(ctx);

    expect(ctx.state.ogImageHashCache.size).toBe(0);
  });

  it("a skipClean run preserves the OG hash cache (prior PNGs survive on disk)", () => {
    const ctx = makeCtx({});
    ctx.state.ogImageHashCache.set("hello", "warm-hash");

    resetRun(ctx, { skipClean: true });

    expect(ctx.state.ogImageHashCache.get("hello")).toBe("warm-hash");
  });

  it("two consecutive clean runs render the OG PNGs both times (no stale-cache skip)", async () => {
    const article = makeArticle();
    const ctx = makeCtx({
      config: { outDir: tmp, ogImage: { fontDir: "./fonts" } },
      requireMap: { i18n: { defaultLocale: () => "en", locales: () => ["en"] } }
    });
    ctx.state.buildCache.set(CONTENT_CACHE_KEY, new Map([["en", [article]]]));
    const renderPng = vi.fn(async () => new Uint8Array([1]));
    const pngPath = path.join(tmp, "og", "hello-world.png");

    // Run 1 — a cold cache renders and writes the PNG.
    const first = await generateOgImages(ctx, { renderPng });
    expect(first?.rendered).toBe(1);
    expect(existsSync(pngPath)).toBe(true);

    // Between in-process runs the pipeline resets state, then a clean run rm -rf's the outDir.
    resetRun(ctx);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    ctx.state.buildCache.set(CONTENT_CACHE_KEY, new Map([["en", [article]]])); // content phase re-runs

    // Run 2 — the wipe deleted the PNG, so it must be rendered again, not reported as skipped.
    const second = await generateOgImages(ctx, { renderPng });
    expect(second?.rendered).toBe(1);
    expect(second?.skipped).toBe(0);
    expect(existsSync(pngPath)).toBe(true);
  });
});
