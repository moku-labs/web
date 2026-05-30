/**
 * @file Integration scenario 2 — a multi-language site (i18n).
 *
 * Builds the bilingual fixture (en default + uk) through the real `createApp` with
 * locale-prefixed routes, asserting per-locale page output, the en-only post's
 * fallback into uk, hreflang/x-default head alternates, the `<html lang>` attribute,
 * and the wired i18n translation + ogLocale surface.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ArticlesByLocale,
  buildBlogApp,
  cleanup,
  loadFixtureArticles,
  tmpDir
} from "./helpers/harness";

const LOCALES = ["en", "uk"] as const;
const NATIVE_SLUGS = ["hello-world", "getting-started"] as const;

describe("integration: multi-language site (i18n)", () => {
  let tmp: string;
  let byLocale: ArticlesByLocale;

  beforeEach(async () => {
    tmp = tmpDir("int-i18n-");
    byLocale = await loadFixtureArticles(LOCALES);
  });
  afterEach(() => cleanup(tmp));

  it("builds locale-prefixed pages for every locale", async () => {
    const out = path.join(tmp, "dist");
    await buildBlogApp({ outDir: out, byLocale, locales: LOCALES, localized: true }).build.run();

    expect(existsSync(path.join(out, "index.html"))).toBe(true);
    for (const locale of LOCALES) {
      for (const slug of NATIVE_SLUGS) {
        expect(existsSync(path.join(out, locale, slug, "index.html"))).toBe(true);
      }
    }
  });

  it("resolves the en-only post into uk through the default-locale fallback", async () => {
    // second-post ships only in English; the content plugin marks the uk variant as a fallback.
    expect(byLocale.get("uk")?.get("second-post")?.isFallback).toBe(true);

    const out = path.join(tmp, "dist");
    await buildBlogApp({ outDir: out, byLocale, locales: LOCALES, localized: true }).build.run();
    expect(existsSync(path.join(out, "uk", "second-post", "index.html"))).toBe(true);
  });

  it("composes hreflang alternates (+ x-default), the html lang, and localized body", async () => {
    const out = path.join(tmp, "dist");
    await buildBlogApp({ outDir: out, byLocale, locales: LOCALES, localized: true }).build.run();

    const html = readFileSync(path.join(out, "uk", "hello-world", "index.html"), "utf8");
    expect(html).toContain('hreflang="en"');
    expect(html).toContain('hreflang="uk"');
    expect(html).toContain('hreflang="x-default"');
    expect(html).toContain('<html lang="uk"');
    // The Ukrainian source rendered into the uk page.
    expect(html).toContain("Привіт, світе");
  });

  it("exposes the i18n translation + locale-name + ogLocale surface end-to-end", () => {
    const app = buildBlogApp({
      outDir: path.join(tmp, "dist"),
      byLocale,
      locales: LOCALES,
      localized: true
    });
    expect(app.i18n.locales()).toEqual(["en", "uk"]);
    expect(app.i18n.t("uk", "nav.home")).toBe("Головна");
    // Missing key falls through to the key itself (en-fallback then key).
    expect(app.i18n.t("uk", "nav.missing")).toBe("nav.missing");
    expect(app.i18n.localeName("uk")).toBe("Українська");
    expect(app.i18n.ogLocale("uk")).toBe("uk_UA");
  });
});
