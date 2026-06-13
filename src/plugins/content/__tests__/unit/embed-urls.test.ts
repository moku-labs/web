import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContentApi } from "../../api";
import { fileSystemContent, resolveEmbedSource } from "../../providers";
import type { ContentApiContext } from "../../types";

/** Build a content API over `contentDir` (embed-enabled, trusted) via the node provider. */
function makeApi(contentDir: string) {
  const ctx: ContentApiContext = {
    // eslint-disable-next-line unicorn/no-null -- State.loadedAll is `Map | null`; null = "not loaded"
    state: { articles: new Map(), loadedAll: null },
    global: { stage: "development" },
    emit: vi.fn(),
    locales: () => ["en", "ru"],
    defaultLocale: () => "en",
    provider: fileSystemContent({ contentDir, trustedContent: true, embed: true })
  };
  return createContentApi(ctx);
}

/** Frontmatter + a single `::embed` directive body for `src`. */
function postWithEmbed(src: string): string {
  return (
    "---\ntitle: Post\ndate: 2026-01-15\ndescription: d\ntags: [x]\nlanguage: en\n---\n\n" +
    `::embed{src="${src}" title="Game"}\n`
  );
}

describe("content/providers resolveEmbedSource", () => {
  it("passes absolute targets through unchanged", () => {
    expect(resolveEmbedSource("https://x.dev/g/", "post")).toBe("https://x.dev/g/");
    expect(resolveEmbedSource("/games/x/", "post")).toBe("/games/x/");
  });

  it("resolves co-located relative paths against /<slug>/", () => {
    expect(resolveEmbedSource("./game/index.html", "post")).toBe("/post/game/index.html");
    expect(resolveEmbedSource("game/index.html", "post")).toBe("/post/game/index.html");
    expect(resolveEmbedSource("./game/", "post")).toBe("/post/game/");
  });

  it("normalizes .. segments and preserves query/hash verbatim", () => {
    expect(resolveEmbedSource("../shared/g/", "post")).toBe("/shared/g/");
    expect(resolveEmbedSource("./game/?lang=ru#top", "post")).toBe("/post/game/?lang=ru#top");
  });
});

describe("content/api embed-url rewrite", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "content-embed-urls-"));
    mkdirSync(path.join(tmp, "post"), { recursive: true });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("rewrites a co-located relative embed src to a shared absolute path", async () => {
    writeFileSync(path.join(tmp, "post", "en.md"), postWithEmbed("./game/index.html"));
    const article = await makeApi(tmp).load("post", "en");
    expect(article.html).toContain('data-embed-src="/post/game/index.html"');
    expect(article.html).not.toContain('data-embed-src="./game');
  });

  it("uses the same shared path regardless of the requested locale", async () => {
    writeFileSync(path.join(tmp, "post", "en.md"), postWithEmbed("./game/index.html"));
    const article = await makeApi(tmp).load("post", "ru"); // falls back to en.md
    expect(article.html).toContain('data-embed-src="/post/game/index.html"');
  });

  it("leaves an external embed src untouched", async () => {
    writeFileSync(path.join(tmp, "post", "en.md"), postWithEmbed("https://game.example.com/"));
    const article = await makeApi(tmp).load("post", "en");
    expect(article.html).toContain('data-embed-src="https://game.example.com/"');
  });
});
