import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCoreConfig } from "@moku-labs/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { i18nPlugin } from "../../../i18n";
import { logPlugin } from "../../../log";
import { contentPlugin } from "../../index";
import { fileSystemContent } from "../../providers";
import type { Api, Article, ArticleCard, Frontmatter } from "../../types";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/content", import.meta.url));
const GOLDEN_PATH = fileURLToPath(new URL("../fixtures/golden-hello-world.html", import.meta.url));

/** Fresh framework config registering the log core plugin (for the event harness). */
function makeConfig(mode: "production" | "development") {
  return createCoreConfig("web-test", {
    config: { isDevelopment: mode === "development" },
    plugins: [logPlugin],
    pluginConfigs: { log: { mode: "test" as const } }
  });
}

/** Default bilingual i18n config used by the fixture app. */
const DEFAULT_I18N: Record<string, unknown> = { locales: ["en", "uk"], defaultLocale: "en" };

/** Build an app with i18n + content over the fixture directory. */
function buildApp(
  mode: "production" | "development" = "development",
  i18n: Record<string, unknown> = DEFAULT_I18N
) {
  const coreConfig = makeConfig(mode);
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  return createApp({
    plugins: [i18nPlugin, contentPlugin],
    pluginConfigs: {
      i18n,
      content: { providers: [fileSystemContent({ contentDir: FIXTURE_DIR })] }
    }
  });
}

describe("content plugin integration", () => {
  it("createApp + fixtures: loadAll returns a locale-keyed map with expected counts", async () => {
    const app = buildApp("development");
    const byLocale = await app.content.loadAll();
    expect([...byLocale.keys()].toSorted()).toEqual(["en", "uk"]);
    // en: hello-world, second-post, draft-post (dev keeps drafts).
    expect(byLocale.get("en")).toHaveLength(3);
    // uk: hello-world native; second-post + draft-post fall back to en.
    expect(byLocale.get("uk")).toHaveLength(3);
  });

  it("emits content:ready (observed by a listening plugin + log harness)", async () => {
    const seen: Array<{ locales: readonly string[]; articleCount: number }> = [];
    const coreConfig = makeConfig("development");
    const { createPlugin, createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
    const probePlugin = createPlugin("content-probe", {
      depends: [contentPlugin],
      hooks: ctx => ({
        "content:ready": payload => {
          seen.push(payload);
          ctx.log.info("content:ready", payload);
        }
      })
    });
    const app = createApp({
      plugins: [i18nPlugin, contentPlugin, probePlugin],
      pluginConfigs: {
        i18n: { locales: ["en"], defaultLocale: "en" },
        content: { providers: [fileSystemContent({ contentDir: FIXTURE_DIR })] }
      }
    });
    await app.content.loadAll();
    // The kernel emit reached the listening plugin's hook.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.locales).toEqual(["en"]);
    expect(seen[0]?.articleCount).toBe(3);
    // ...and the hook's log is visible through the harness DSL.
    expect(() => app.log.expect().toHaveEvent("content:ready")).not.toThrow();
  });

  it("byte-compares rendered Article.html against the committed golden fixture", async () => {
    const app = buildApp("development");
    const article = await app.content.load("hello-world", "en");
    // Self-consistent golden: a GENERATED post-sanitize snapshot (not legacy
    // bytes). Written once if absent, then byte-compared on subsequent runs.
    if (!existsSync(GOLDEN_PATH)) {
      writeFileSync(GOLDEN_PATH, article.html, "utf8");
    }
    const golden = readFileSync(GOLDEN_PATH, "utf8");
    expect(article.html).toBe(golden);
    // Structural + security assertions independent of the snapshot.
    expect(article.html).toContain("<h1");
    expect(article.html).toContain("shiki");
    expect(article.html).not.toContain("<script");
  });

  it("verifies locale fallback and production draft filtering end-to-end", async () => {
    const dev = buildApp("development");
    const fallback = await dev.content.load("second-post", "uk");
    expect(fallback.isFallback).toBe(true);
    expect(fallback.locale).toBe("uk");
    expect(fallback.url).toBe("/uk/second-post/");

    const prod = buildApp("production");
    const prodByLocale = await prod.content.loadAll();
    const en = prodByLocale.get("en") ?? [];
    expect(en.some(a => a.computed.slug === "draft-post")).toBe(false);
    expect(en).toHaveLength(2);
  });

  it("type-level: app.content exposes the full Api surface", () => {
    const app = buildApp();
    expectTypeOf(app.content).toMatchTypeOf<Api>();
    expectTypeOf(app.content.loadAll).returns.resolves.toEqualTypeOf<Map<string, Article[]>>();
    expectTypeOf(app.content.articleToCard).parameter(0).toEqualTypeOf<Article>();
    expectTypeOf(app.content.articleToCard).returns.toEqualTypeOf<ArticleCard>();
    expectTypeOf<Frontmatter>().toHaveProperty("title");
  });
});
