import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTENT_CACHE_KEY } from "../../phases/content";
import { generateOgImages } from "../../phases/og-images";
import { assertSafeCleanTarget, planIncrementalRebuild, resetRun } from "../../pipeline";
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

describe("build/pipeline assertSafeCleanTarget", () => {
  /** A synthetic project root OUTSIDE the OS temp area (pure path math — never touched). */
  const ROOT = path.join(path.sep, "srv", "example-site");

  it("rejects the filesystem root", () => {
    expect(() => assertSafeCleanTarget(path.sep, ROOT)).toThrow(/not a safe clean target/);
  });

  it('rejects "." and the project root itself (relative and absolute spellings)', () => {
    expect(() => assertSafeCleanTarget(".", ROOT)).toThrow(/not a safe clean target/);
    expect(() => assertSafeCleanTarget("./", ROOT)).toThrow(/not a safe clean target/);
    expect(() => assertSafeCleanTarget(ROOT, ROOT)).toThrow(/not a safe clean target/);
  });

  it('rejects a ".." escape and any ancestor of the project root', () => {
    expect(() => assertSafeCleanTarget("..", ROOT)).toThrow(/not a safe clean target/);
    expect(() => assertSafeCleanTarget("../sibling", ROOT)).toThrow(/not a safe clean target/);
    expect(() => assertSafeCleanTarget(path.dirname(ROOT), ROOT)).toThrow(
      /not a safe clean target/
    );
  });

  it("rejects the home directory, even when it sits inside the build's root", () => {
    // Configured directly (an absolute "~" expansion gone wrong) …
    expect(() => assertSafeCleanTarget(homedir(), ROOT)).toThrow(/not a safe clean target/);
    // … and even when the build runs from an ancestor of home, so home is "inside root".
    expect(() => assertSafeCleanTarget(homedir(), path.dirname(homedir()))).toThrow(
      /not a safe clean target/
    );
  });

  it("rejects an absolute path outside both the project root and the OS temp area", () => {
    expect(() => assertSafeCleanTarget(path.join(path.sep, "srv", "other-site"), ROOT)).toThrow(
      /not a safe clean target/
    );
  });

  it("rejects the OS temp directory itself (only paths strictly inside it are disposable)", () => {
    expect(() => assertSafeCleanTarget(tmpdir(), ROOT)).toThrow(/not a safe clean target/);
  });

  it("accepts a relative outDir inside the project root and returns it resolved", () => {
    expect(assertSafeCleanTarget("./dist", ROOT)).toBe(path.join(ROOT, "dist"));
    expect(assertSafeCleanTarget("out/site", ROOT)).toBe(path.join(ROOT, "out", "site"));
  });

  it("accepts an absolute outDir nested inside the project root", () => {
    const nested = path.join(ROOT, "dist");
    expect(assertSafeCleanTarget(nested, ROOT)).toBe(nested);
  });

  it("accepts an absolute outDir strictly inside the OS temp area (preview/test builds)", () => {
    const scratch = path.join(tmpdir(), "moku-preview", "dist");
    expect(assertSafeCleanTarget(scratch, ROOT)).toBe(scratch);
  });

  it("the error is actionable — it names the offender, the rule, and the fix", () => {
    expect(() => assertSafeCleanTarget(".", ROOT)).toThrow(
      /\[web\] build\.outDir:[\s\S]*force-deletes[\s\S]*inside the project/
    );
  });
});
