import { describe, expect, it, vi } from "vitest";
import type { BundleRunner } from "../../phases/bundle";
import { bundle } from "../../phases/bundle";
import { makeCtx } from "../helpers";

describe("build/phases/bundle", () => {
  it("invokes the bundler with correct entrypoints + minify flag (CSS and JS separately)", async () => {
    const runner = vi.fn(async (opts: Parameters<BundleRunner>[0]) => ({
      success: true,
      outputs: [{ path: `out/${opts.entrypoints[0]}-abc123.out`, kind: "entry-point" }]
    }));
    const ctx = makeCtx({ config: { outDir: "./dist", minify: false } });
    await bundle(ctx, {
      runner,
      cssEntrypoints: ["styles.css"],
      jsEntrypoints: ["main.ts"]
    });
    expect(runner).toHaveBeenCalledTimes(2);
    // Separate CSS + JS passes (mixed-entrypoint segfault avoidance).
    expect(runner.mock.calls[0]?.[0].entrypoints).toEqual(["styles.css"]);
    expect(runner.mock.calls[1]?.[0].entrypoints).toEqual(["main.ts"]);
    // minify flag honored.
    expect(runner.mock.calls[0]?.[0].minify).toBe(false);
  });

  it("enables code splitting + an explicit browser target on every pass", async () => {
    // Regression: `Bun.build` defaults to splitting:false, which INLINED local
    // dynamic imports — the spa lazy render chunk (Preact `render`) and the data
    // plugin's node-only writer (with a silently shimmed node:fs/promises) shipped
    // in every deployed client bundle instead of being split into lazy chunks.
    const runner = vi.fn(async (_opts: Parameters<BundleRunner>[0]) => ({
      success: true,
      outputs: []
    }));
    const ctx = makeCtx({ config: { outDir: "./dist", minify: false } });
    await bundle(ctx, { runner, cssEntrypoints: ["styles.css"], jsEntrypoints: ["main.ts"] });
    expect(runner).toHaveBeenCalledTimes(2);
    for (const call of runner.mock.calls) {
      expect(call[0].splitting).toBe(true);
      expect(call[0].target).toBe("browser");
    }
  });

  it("caches hashed asset paths in state.buildCache keyed by kind (web-relative to outDir)", async () => {
    const runner = vi.fn(async () => ({
      success: true,
      outputs: [{ path: "dist/assets/styles-9f8e.css", kind: "entry-point" }]
    }));
    const ctx = makeCtx({ config: { outDir: "./dist", minify: true } });
    await bundle(ctx, { runner, cssEntrypoints: ["styles.css"], jsEntrypoints: [] });
    const css = ctx.state.buildCache.get("css") as Record<string, string>;
    // Stored RELATIVE to outDir ("assets/…"), NOT the raw runner path — `buildAssetTags`
    // prepends "/" to make a valid root-absolute URL.
    expect(css).toEqual({ "styles-9f8e.css": "assets/styles-9f8e.css" });
    // JS pass had no entrypoints → not invoked, nothing cached.
    expect(ctx.state.buildCache.has("js")).toBe(false);
  });

  it("normalizes an ABSOLUTE runner output path to a web-relative asset path", async () => {
    // Regression: Bun.build returns absolute paths. Storing them verbatim produced a broken
    // protocol-relative URL ("//Users/.../main.css") that no browser could load.
    const runner = vi.fn(async () => ({
      success: true,
      outputs: [{ path: "/Users/me/proj/dist/assets/main-abc123.css", kind: "entry-point" }]
    }));
    const ctx = makeCtx({ config: { outDir: "/Users/me/proj/dist", minify: true } });
    await bundle(ctx, { runner, cssEntrypoints: ["styles.css"], jsEntrypoints: [] });
    const css = ctx.state.buildCache.get("css") as Record<string, string>;
    expect(css).toEqual({ "main-abc123.css": "assets/main-abc123.css" });
    // No leading slash → "/" + value is a single-slash root-absolute URL.
    expect(Object.values(css)[0]?.startsWith("/")).toBe(false);
  });

  it("excludes lazy split chunks from the recorded asset manifest (entry stays)", async () => {
    // With splitting on, the runner emits chunk artifacts alongside the entry. The
    // manifest feeds the pages phase's <script> injection — recording a chunk would
    // eagerly load it on every page, defeating the lazy split.
    const runner = vi.fn(async () => ({
      success: true,
      outputs: [
        { path: "dist/assets/main.js", kind: "entry-point" },
        { path: "dist/assets/chunk-render-1a2b.js", kind: "chunk" },
        { path: "dist/assets/chunk-writer-3c4d.js", kind: "chunk" }
      ]
    }));
    const ctx = makeCtx({ config: { outDir: "./dist", minify: true } });
    await bundle(ctx, { runner, cssEntrypoints: [], jsEntrypoints: ["main.ts"] });
    const js = ctx.state.buildCache.get("js") as Record<string, string>;
    expect(js).toEqual({ "main.js": "assets/main.js" });
  });

  it("requests content-hashed naming for EVERY output kind (entry points included)", async () => {
    // Bun's default naming only hashes chunks/assets — entry points keep stable
    // names ("main.css"), which a CDN/browser can cache stale across deploys.
    // Fingerprinted entry names are what make the immutable cache rules safe.
    const runner = vi.fn(async (_opts: Parameters<BundleRunner>[0]) => ({
      success: true,
      outputs: []
    }));
    const ctx = makeCtx({ config: { outDir: "./dist", minify: true } });
    await bundle(ctx, { runner, cssEntrypoints: ["styles.css"], jsEntrypoints: ["main.ts"] });
    expect(runner).toHaveBeenCalledTimes(2);
    for (const call of runner.mock.calls) {
      expect(call[0].naming).toEqual({
        entry: "[dir]/[name]-[hash].[ext]",
        chunk: "chunk-[hash].[ext]",
        asset: "[name]-[hash].[ext]"
      });
    }
  });

  it("marks font url() globs external on the CSS pass only (JS pass bundles everything)", async () => {
    // Regression: Bun's CSS bundler cannot emit url() assets as files — every
    // resolvable font reference was inlined as a base64 data URI, shipping a
    // site's whole vendored font set (every weight + subset) render-blocking in
    // the stylesheet. External font globs pass the URLs through verbatim; the
    // JS pass keeps an empty list because an external import in a JS bundle
    // would be an unresolvable module at runtime.
    const runner = vi.fn(async (_opts: Parameters<BundleRunner>[0]) => ({
      success: true,
      outputs: []
    }));
    const ctx = makeCtx({ config: { outDir: "./dist", minify: true } });
    await bundle(ctx, { runner, cssEntrypoints: ["styles.css"], jsEntrypoints: ["main.ts"] });
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[0]?.[0].external).toEqual([
      "*.woff2",
      "*.woff",
      "*.ttf",
      "*.otf",
      "*.eot"
    ]);
    expect(runner.mock.calls[1]?.[0].external).toEqual([]);
  });

  it("records the COMPLETE per-kind output list (chunks included) under `<kind>:outputs`", async () => {
    // The embeddable manifest excludes chunks, but the cache-headers phase needs
    // EVERY fingerprinted file to emit its per-file immutable rule.
    const runner = vi.fn(async () => ({
      success: true,
      outputs: [
        { path: "dist/assets/spa-abc1.js", kind: "entry-point" },
        { path: "dist/assets/chunk-def2.js", kind: "chunk" }
      ]
    }));
    const ctx = makeCtx({ config: { outDir: "./dist", minify: true } });
    await bundle(ctx, { runner, cssEntrypoints: [], jsEntrypoints: ["main.ts"] });
    expect(ctx.state.buildCache.get("js:outputs")).toEqual([
      "assets/spa-abc1.js",
      "assets/chunk-def2.js"
    ]);
    expect(ctx.state.buildCache.get("js")).toEqual({ "spa-abc1.js": "assets/spa-abc1.js" });
  });

  it("runs the CSS + JS passes concurrently (both in flight before either resolves)", async () => {
    let active = 0;
    let peak = 0;
    const runner = vi.fn(async (_opts: Parameters<BundleRunner>[0]) => {
      active += 1;
      peak = Math.max(peak, active);
      // Yield a microtask so the sibling pass can start before this one resolves.
      await Promise.resolve();
      active -= 1;
      return { success: true, outputs: [] };
    });
    const ctx = makeCtx({ config: { outDir: "./dist", minify: false } });
    await bundle(ctx, { runner, cssEntrypoints: ["styles.css"], jsEntrypoints: ["main.ts"] });
    expect(runner).toHaveBeenCalledTimes(2);
    // Both passes overlapped (sequential awaits would peak at 1).
    expect(peak).toBe(2);
    // CSS is still dispatched first (runner invocation order preserved).
    expect(runner.mock.calls[0]?.[0].entrypoints).toEqual(["styles.css"]);
    expect(runner.mock.calls[1]?.[0].entrypoints).toEqual(["main.ts"]);
  });

  it("skips a pass with no entrypoints (no runner call)", async () => {
    const runner = vi.fn(async () => ({ success: true, outputs: [] }));
    const ctx = makeCtx({});
    await bundle(ctx, { runner, cssEntrypoints: [], jsEntrypoints: [] });
    expect(runner).not.toHaveBeenCalled();
  });

  it("throws an actionable error when a bundler pass fails", async () => {
    const runner = vi.fn(async () => ({ success: false, outputs: [] }));
    const ctx = makeCtx({});
    await expect(
      bundle(ctx, { runner, cssEntrypoints: ["styles.css"], jsEntrypoints: [] })
    ).rejects.toThrow(/\[web\] build\.bundle/);
  });
});
