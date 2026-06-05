import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createContentApi } from "../../api";
import { fileSystemContent } from "../../providers";
import type { Article, ContentApiContext, ContentEvents, State } from "../../types";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/content", import.meta.url));

type EmitSpy = ReturnType<typeof vi.fn> &
  (<K extends keyof ContentEvents>(event: K, payload: ContentEvents[K]) => void);

/** Build a kernel-free api context over the fixture content dir (via the node provider). */
function makeCtx(
  overrides: Partial<{
    mode: "production" | "development";
    locales: readonly string[];
    defaultLocale: string;
  }> = {}
) {
  const state: State = { articles: new Map() };
  const emit = vi.fn() as EmitSpy;
  const ctx: ContentApiContext = {
    state,
    global: { isDevelopment: (overrides.mode ?? "development") === "development" },
    emit,
    locales: () => overrides.locales ?? ["en", "uk"],
    defaultLocale: () => overrides.defaultLocale ?? "en",
    provider: fileSystemContent({ contentDir: FIXTURE_DIR, shikiTheme: "github-dark" })
  };
  return { ctx, state, emit };
}

const sampleArticle: Article = {
  frontmatter: {
    title: "Hello",
    date: "2026-01-15",
    description: "Intro",
    tags: ["a"],
    language: "en",
    draft: false,
    author: "Alex"
  },
  computed: {
    slug: "hello",
    readingTime: 2,
    contentId: "hello",
    status: "published",
    wordCount: 100
  },
  html: "<p>hi</p>",
  locale: "en",
  isFallback: false,
  url: "/en/hello/"
};

describe("content/api", () => {
  it("articleToCard projects an Article to the lightweight card shape", () => {
    const { ctx } = makeCtx();
    const card = createContentApi(ctx).articleToCard(sampleArticle);
    expect(card).toEqual({
      contentId: "hello",
      status: "published",
      title: "Hello",
      date: "2026-01-15",
      description: "Intro",
      tags: ["a"],
      readingTime: 2,
      url: "/en/hello/"
    });
    // Pure projection — no html leaked.
    expect("html" in card).toBe(false);
  });

  it("loadAll emits content:ready with { locales, articleCount }", async () => {
    const { ctx, emit } = makeCtx({ locales: ["en"], defaultLocale: "en" });
    const byLocale = await createContentApi(ctx).loadAll();
    const en = byLocale.get("en") ?? [];
    // hello-world, second-post, draft-post all present in development.
    expect(en.length).toBe(3);
    expect(emit).toHaveBeenCalledWith("content:ready", {
      locales: ["en"],
      articleCount: 3
    });
  });

  it("loadAll sorts date-descending and assigns contentId", async () => {
    const { ctx } = makeCtx({ locales: ["en"], defaultLocale: "en" });
    const byLocale = await createContentApi(ctx).loadAll();
    const en = byLocale.get("en") ?? [];
    // second-post (2026-03-20) is newest, then draft-post (02-01), then hello-world (01-15).
    expect(en[0]?.computed.slug).toBe("second-post");
    expect(en.at(-1)?.computed.slug).toBe("hello-world");
    for (const a of en) expect(a.computed.contentId).toBeTruthy();
  });

  it("invalidate drops the slug cache entry and emits content:invalidated", async () => {
    const { ctx, state } = makeCtx({ locales: ["en"], defaultLocale: "en" });
    const api = createContentApi(ctx);
    await api.loadAll();
    expect(state.articles.get("en")?.has("hello-world")).toBe(true);
    api.invalidate([`${FIXTURE_DIR}/hello-world/en.md`]);
    // The shell drops the derived slug cache entry (provider re-reads on next scan).
    expect(state.articles.get("en")?.has("hello-world")).toBe(false);
  });

  it("invalidate ignores empty/whitespace paths and emits only the accepted ones", () => {
    const { ctx, emit } = makeCtx();
    createContentApi(ctx).invalidate(["", "   ", "src/content/x/en.md"]);
    expect(emit).toHaveBeenCalledWith("content:invalidated", {
      paths: ["src/content/x/en.md"]
    });
  });

  it("renderMarkdown renders through the provider pipeline (reused across calls)", async () => {
    const { ctx } = makeCtx();
    const api = createContentApi(ctx);
    const first = await api.renderMarkdown("# one");
    const second = await api.renderMarkdown("# two");
    expect(first).toContain("one");
    expect(second).toContain("two");
  });

  it("load uses default-locale file with isFallback=true when locale missing", async () => {
    const { ctx } = makeCtx({ locales: ["en", "uk"], defaultLocale: "en" });
    const api = createContentApi(ctx);
    // second-post has only en.md; requesting uk falls back to en content.
    const article = await api.load("second-post", "uk");
    expect(article.isFallback).toBe(true);
    expect(article.locale).toBe("uk");
    expect(article.url).toBe("/uk/second-post/");
    expect(article.frontmatter.title).toBe("Second Post");
  });

  it("load returns native file (isFallback=false) when locale exists", async () => {
    const { ctx } = makeCtx({ locales: ["en", "uk"], defaultLocale: "en" });
    const article = await createContentApi(ctx).load("hello-world", "uk");
    expect(article.isFallback).toBe(false);
    expect(article.locale).toBe("uk");
    expect(article.frontmatter.language).toBe("uk");
  });

  it("load throws [web] content when neither requested nor default file exists", async () => {
    const { ctx } = makeCtx({ locales: ["en"], defaultLocale: "en" });
    await expect(createContentApi(ctx).load("missing-slug", "en")).rejects.toThrow(
      /\[web\] content/
    );
  });

  it("load throws the not-found error for a draft slug in production", async () => {
    const { ctx } = makeCtx({ locales: ["en"], defaultLocale: "en", mode: "production" });
    // The IDENTICAL message the null-resolve path throws (security: drafts must
    // be indistinguishable from missing articles in production).
    const expectedMessage =
      `[web] content article "draft-post" not found for locale "en".\n` +
      `  Looked for draft-post/en.md and the default-locale fallback.`;
    await expect(createContentApi(ctx).load("draft-post", "en")).rejects.toThrow(expectedMessage);
  });

  it("load returns the draft article in development", async () => {
    const { ctx } = makeCtx({ locales: ["en"], defaultLocale: "en", mode: "development" });
    const article = await createContentApi(ctx).load("draft-post", "en");
    expect(article.computed.slug).toBe("draft-post");
    expect(article.computed.status).toBe("draft");
  });

  it("load returns a published article in both production and development", async () => {
    const prod = makeCtx({ locales: ["en"], defaultLocale: "en", mode: "production" });
    const prodArticle = await createContentApi(prod.ctx).load("hello-world", "en");
    expect(prodArticle.computed.slug).toBe("hello-world");
    expect(prodArticle.computed.status).toBe("published");

    const dev = makeCtx({ locales: ["en"], defaultLocale: "en", mode: "development" });
    const devArticle = await createContentApi(dev.ctx).load("hello-world", "en");
    expect(devArticle.computed.slug).toBe("hello-world");
    expect(devArticle.computed.status).toBe("published");
  });

  it("drafts are excluded in production mode, included in development", async () => {
    const prod = makeCtx({ locales: ["en"], defaultLocale: "en", mode: "production" });
    const prodByLocale = await createContentApi(prod.ctx).loadAll();
    const prodArticles = prodByLocale.get("en") ?? [];
    expect(prodArticles.some(a => a.computed.slug === "draft-post")).toBe(false);
    expect(prodArticles).toHaveLength(2);

    const dev = makeCtx({ locales: ["en"], defaultLocale: "en", mode: "development" });
    const devByLocale = await createContentApi(dev.ctx).loadAll();
    const devArticles = devByLocale.get("en") ?? [];
    expect(devArticles.some(a => a.computed.slug === "draft-post")).toBe(true);
  });
});
