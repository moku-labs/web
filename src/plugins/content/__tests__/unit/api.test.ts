import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createContentApi } from "../../api";
import { createContentState } from "../../state";
import type { Article, Config, ContentApiContext, ContentEvents } from "../../types";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/content", import.meta.url));

const baseConfig: Config = {
  contentDir: FIXTURE_DIR,
  trustedContent: false,
  extraRemarkPlugins: [],
  extraRehypePlugins: [],
  shikiTheme: "github-dark"
};

type EmitSpy = ReturnType<typeof vi.fn> &
  (<K extends keyof ContentEvents>(event: K, payload: ContentEvents[K]) => void);

/** Build a kernel-free api context over the fixture content dir. */
function makeCtx(
  overrides: Partial<{
    config: Config;
    mode: "production" | "development";
    locales: readonly string[];
    defaultLocale: string;
  }> = {}
) {
  const config = overrides.config ?? baseConfig;
  const state = createContentState({ global: {}, config });
  const emit = vi.fn() as EmitSpy;
  const ctx: ContentApiContext = {
    state,
    config,
    global: { mode: overrides.mode ?? "development" },
    emit,
    locales: () => overrides.locales ?? ["en", "uk"],
    defaultLocale: () => overrides.defaultLocale ?? "en",
    articleToUrl: (locale, slug) => `/${locale}/${slug}/`
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

  it("invalidate adds paths to dirtyPaths and removes slug cache entry", async () => {
    const { ctx, state } = makeCtx({ locales: ["en"], defaultLocale: "en" });
    const api = createContentApi(ctx);
    await api.loadAll();
    expect(state.articles.get("en")?.has("hello-world")).toBe(true);
    api.invalidate([`${FIXTURE_DIR}/hello-world/en.md`]);
    expect(state.dirtyPaths.has(`${FIXTURE_DIR}/hello-world/en.md`)).toBe(true);
    expect(state.articles.get("en")?.has("hello-world")).toBe(false);
  });

  it("invalidate ignores empty/whitespace paths and emits content:invalidated", () => {
    const { ctx, state, emit } = makeCtx();
    createContentApi(ctx).invalidate(["", "   ", "src/content/x/en.md"]);
    expect(state.dirtyPaths.has("")).toBe(false);
    expect(state.dirtyPaths.has("   ")).toBe(false);
    expect(state.dirtyPaths.has("src/content/x/en.md")).toBe(true);
    expect(emit).toHaveBeenCalledWith("content:invalidated", {
      paths: ["src/content/x/en.md"]
    });
  });

  it("processor is a singleton per app (reused across renders; new app gets its own)", async () => {
    const { ctx, state } = makeCtx();
    const api = createContentApi(ctx);
    await api.renderMarkdown("# one");
    const first = state.processor;
    expect(first).not.toBeNull();
    await api.renderMarkdown("# two");
    expect(state.processor).toBe(first);

    // A second app/context gets its OWN processor (no module-level sharing).
    const { ctx: ctx2, state: state2 } = makeCtx();
    await createContentApi(ctx2).renderMarkdown("# three");
    expect(state2.processor).not.toBe(first);
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
