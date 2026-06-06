import { describe, expect, it, vi } from "vitest";
import type { Article } from "../../../content/types";
import { CONTENT_CACHE_KEY, loadContent, readCachedContent } from "../../phases/content";
import { makeArticle, makeCtx } from "../helpers";

describe("build/phases/content", () => {
  it("delegates to content.loadAll() and does not parse Markdown itself", async () => {
    const article = makeArticle({ html: "<h1>Pre-rendered by content plugin</h1>" });
    const byLocale = new Map<string, Article[]>([["en", [article]]]);
    const loadAll = vi.fn(async () => byLocale);
    const ctx = makeCtx({ requireMap: { content: { loadAll } } });

    const result = await loadContent(ctx);

    // Delegation: it called the content plugin's loadAll exactly once.
    expect(loadAll).toHaveBeenCalledTimes(1);
    // It returned and cached the content plugin's output verbatim — no re-parsing.
    expect(result).toBe(byLocale);
    expect(ctx.state.buildCache.get(CONTENT_CACHE_KEY)).toBe(byLocale);
    // The article HTML is the content plugin's output, untouched by build.
    expect(readCachedContent(ctx).get("en")?.[0]?.html).toBe(
      "<h1>Pre-rendered by content plugin</h1>"
    );
  });

  it("a full load (no options) reuse-loads false and never invalidates", async () => {
    const loadAll = vi.fn(async () => new Map<string, Article[]>());
    const invalidate = vi.fn();
    const ctx = makeCtx({ requireMap: { content: { loadAll, invalidate } } });

    await loadContent(ctx);

    expect(invalidate).not.toHaveBeenCalled();
    expect(loadAll).toHaveBeenCalledWith({ reuse: false });
  });

  it("an incremental rebuild invalidates the changed Markdown, then reuse-loads", async () => {
    const loadAll = vi.fn(async () => new Map<string, Article[]>());
    const invalidate = vi.fn();
    const ctx = makeCtx({ requireMap: { content: { loadAll, invalidate } } });

    await loadContent(ctx, { reuse: true, changed: ["content/intro/en.md"] });

    expect(invalidate).toHaveBeenCalledWith(["content/intro/en.md"]);
    expect(loadAll).toHaveBeenCalledWith({ reuse: true });
  });

  it("a reuse rebuild with no changed Markdown (e.g. a CSS edit) reuses without invalidating", async () => {
    const loadAll = vi.fn(async () => new Map<string, Article[]>());
    const invalidate = vi.fn();
    const ctx = makeCtx({ requireMap: { content: { loadAll, invalidate } } });

    await loadContent(ctx, { reuse: true, changed: [] });

    expect(invalidate).not.toHaveBeenCalled();
    expect(loadAll).toHaveBeenCalledWith({ reuse: true });
  });

  it("readCachedContent returns an empty map before loadContent runs", () => {
    const ctx = makeCtx({});
    expect(readCachedContent(ctx).size).toBe(0);
  });
});
