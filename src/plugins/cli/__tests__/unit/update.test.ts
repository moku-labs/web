import { describe, expect, it } from "vitest";
import { createApi } from "../../api";
import { devBuildOverrides } from "../../serve";
import { makeCtx } from "../helpers";

describe("cli update()", () => {
  it("runs an incremental build (skipClean + changed + dev overrides) and returns the summary", async () => {
    const result = { outDir: "dist", pageCount: 2, durationMs: 42 };
    const { ctx, build } = makeCtx({ buildResult: result });

    const changed = ["src/islands/board.ts", "src/app.css"];
    const summary = await createApi(ctx).update(changed);

    expect(summary).toEqual(result);
    expect(build.run).toHaveBeenCalledTimes(1);
    // The dev-fast profile: skip the clean, scope to the changed set, and apply the same
    // overrides serve() uses (minify off; og/sitemap/feeds off by default).
    expect(build.run).toHaveBeenCalledWith({
      skipClean: true,
      changed,
      overrides: devBuildOverrides({ og: false, sitemap: false, feeds: false })
    });
  });

  it("renders no command header — the external dev driver owns the per-change TUI", async () => {
    const { ctx, render } = makeCtx();
    await createApi(ctx).update(["src/a.ts"]);
    const calls = (render as ReturnType<typeof makeCtx>["render"] & { calls: unknown[][] }).calls;
    expect(calls.some(call => call[0] === "header")).toBe(false);
  });

  it("does NOT assert the not-found page (dev rebuild) — resolves with no 404 on disk", async () => {
    // makeCtx's default outDir ("dist") has no 404.html, so build() would throw ERR_CLI_NOT_FOUND;
    // update() must skip that assertion and resolve.
    const { ctx } = makeCtx();
    await expect(createApi(ctx).update(["src/a.ts"])).resolves.toBeDefined();
  });

  it("re-enables an output when its opt-in flag is set (feeds)", async () => {
    const { ctx, build } = makeCtx();
    await createApi(ctx).update(["content/post/en.md"], { feeds: true });
    expect(build.run).toHaveBeenCalledWith({
      skipClean: true,
      changed: ["content/post/en.md"],
      overrides: devBuildOverrides({ og: false, sitemap: false, feeds: true })
    });
  });
});
