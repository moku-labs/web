import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContentApi } from "../../api";
import { createContentState } from "../../state";
import type { Config, ContentApiContext } from "../../types";

/** Build a content API over `contentDir`. */
function makeApi(contentDir: string) {
  const config: Config = {
    contentDir,
    trustedContent: true,
    extraRemarkPlugins: [],
    extraRehypePlugins: [],
    shikiTheme: "github-dark"
  };
  const ctx: ContentApiContext = {
    state: createContentState({ global: {}, config }),
    config,
    global: { isDevelopment: true },
    emit: vi.fn(),
    locales: () => ["en", "ru"],
    defaultLocale: () => "en",
    articleToUrl: (locale, slug) => `/${locale}/${slug}/`
  };
  return createContentApi(ctx);
}

describe("content/api image-url rewrite", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "content-image-urls-"));
    mkdirSync(path.join(tmp, "post"), { recursive: true });
    writeFileSync(
      path.join(tmp, "post", "en.md"),
      "---\ntitle: Post\ndate: 2026-01-15\ndescription: d\ntags: [x]\nlanguage: en\n---\n\n![alt](./images/a.webp)\n"
    );
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("rewrites relative image URLs to a shared absolute path", async () => {
    const article = await makeApi(tmp).load("post", "en");
    expect(article.html).toContain('src="/post/images/a.webp"');
    expect(article.html).not.toContain("./images/");
  });

  it("uses the same shared path regardless of the requested locale", async () => {
    const article = await makeApi(tmp).load("post", "ru"); // falls back to en.md
    expect(article.html).toContain('src="/post/images/a.webp"');
  });

  it("preserves nested sub-paths and rewrites a missing ./ prefix", async () => {
    writeFileSync(
      path.join(tmp, "post", "en.md"),
      "---\ntitle: Post\ndate: 2026-01-15\ndescription: d\ntags: [x]\nlanguage: en\n---\n\n" +
        "![nested](./images/ru/deep/b.webp)\n\n![bare](images/c.webp)\n"
    );
    const article = await makeApi(tmp).load("post", "en");
    expect(article.html).toContain('src="/post/images/ru/deep/b.webp"');
    expect(article.html).toContain('src="/post/images/c.webp"');
  });
});
