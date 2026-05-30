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

  it("caches hashed asset paths in state.buildCache keyed by kind", async () => {
    const runner = vi.fn(async () => ({
      success: true,
      outputs: [{ path: "dist/assets/styles-9f8e.css", kind: "entry-point" }]
    }));
    const ctx = makeCtx({ config: { minify: true } });
    await bundle(ctx, { runner, cssEntrypoints: ["styles.css"], jsEntrypoints: [] });
    const css = ctx.state.buildCache.get("css") as Record<string, string>;
    expect(css).toEqual({ "styles-9f8e.css": "dist/assets/styles-9f8e.css" });
    // JS pass had no entrypoints → not invoked, nothing cached.
    expect(ctx.state.buildCache.has("js")).toBe(false);
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
