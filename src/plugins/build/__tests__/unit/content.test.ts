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

  it("readCachedContent returns an empty map before loadContent runs", () => {
    const ctx = makeCtx({});
    expect(readCachedContent(ctx).size).toBe(0);
  });
});
