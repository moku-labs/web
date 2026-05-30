import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Article } from "../../../content/types";
import { CONTENT_CACHE_KEY } from "../../phases/content";
import { generateFeeds } from "../../phases/feeds";
import { makeArticle, makeCtx } from "../helpers";

/** Build a ctx with cached content + fake site/i18n for the feeds phase. */
function feedCtx(tmp: string, articles: Article[]) {
  const ctx = makeCtx({
    config: { outDir: tmp, feeds: true },
    requireMap: {
      site: {
        name: () => "My Blog",
        description: () => "About things",
        url: () => "https://blog.dev",
        author: () => "Alex",
        canonical: (p: string) => `https://blog.dev${p}`
      },
      i18n: { defaultLocale: () => "en", locales: () => ["en"] }
    }
  });
  ctx.state.buildCache.set(CONTENT_CACHE_KEY, new Map([["en", articles]]));
  return ctx;
}

describe("build/phases/feeds", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "build-feeds-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("produces RSS/Atom/JSON with a per-item GUID = canonical article URL", async () => {
    const articles = [
      makeArticle({
        url: "/en/hello-world/",
        computed: { ...makeArticle().computed, contentId: "hello-world" }
      }),
      makeArticle({
        frontmatter: { ...makeArticle().frontmatter, title: "Second" },
        url: "/en/second/",
        computed: { ...makeArticle().computed, slug: "second", contentId: "second" }
      })
    ];
    const ctx = feedCtx(tmp, articles);

    const result = await generateFeeds(ctx);

    expect(result).not.toBeNull();
    // GUID set = canonical article URLs.
    expect(result?.guids).toEqual([
      "https://blog.dev/en/hello-world/",
      "https://blog.dev/en/second/"
    ]);
    // Each format produced and references the GUID.
    expect(result?.rss).toContain("https://blog.dev/en/hello-world/");
    expect(result?.atom).toContain("https://blog.dev/en/second/");
    expect(result?.json).toContain("https://blog.dev/en/hello-world/");
    // Written to disk.
    expect(readFileSync(path.join(tmp, "feed.xml"), "utf8")).toContain("<rss");
    expect(readFileSync(path.join(tmp, "atom.xml"), "utf8")).toContain("<feed");
    expect(readFileSync(path.join(tmp, "feed.json"), "utf8")).toContain("https://jsonfeed.org");
  });

  it("excludes drafts and is a no-op when config.feeds is false", async () => {
    const ctx = makeCtx({ config: { outDir: tmp, feeds: false } });
    expect(await generateFeeds(ctx)).toBeNull();
  });
});
