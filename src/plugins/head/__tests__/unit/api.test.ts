import { describe, expect, it } from "vitest";
import type { ApiContext } from "../../api";
import { createApi } from "../../api";
import { normalizeHeadConfig, validateHeadConfig } from "../../config";
import type { HeadDefaults, ResolvedRoute } from "../../types";

/** A site API stub for render() tests. */
function makeSite() {
  return {
    name: () => "My Site",
    url: () => "https://blog.dev",
    author: () => "Alex",
    description: () => "Site description",
    canonical: (path: string) => `https://blog.dev${path}`
  };
}

/** An i18n API stub for render() tests. */
function makeI18n() {
  return {
    locales: () => ["en"] as readonly string[],
    defaultLocale: () => "en",
    isLocale: (x: string) => x === "en",
    localeName: () => "English",
    ogLocale: () => "en_US",
    t: (_l: string, key: string) => key
  };
}

/** A router API stub for render() tests. */
function makeRouter() {
  return { toUrl: (_n: string, _p: Record<string, string>) => "/post/" };
}

const DEFAULTS: HeadDefaults = { twitterCard: "summary_large_image" };

/** Build a mock plugin ctx for createApi. */
function makeCtx(): ApiContext {
  const site = makeSite();
  const i18n = makeI18n();
  const router = makeRouter();
  const byName: Record<string, unknown> = { site, i18n, router };
  return {
    state: { defaults: DEFAULTS },
    require: ((plugin: { name: string }) => byName[plugin.name]) as ApiContext["require"]
  };
}

/** Build a ctx whose head defaults carry a default OG image (for siteHead tests). */
function makeCtxWithImage(defaults: Partial<HeadDefaults> = {}): ApiContext {
  const byName: Record<string, unknown> = {
    site: makeSite(),
    i18n: makeI18n(),
    router: makeRouter()
  };
  const withImage: HeadDefaults = {
    twitterCard: "summary_large_image",
    defaultOgImage: "/og-default.png",
    ...defaults
  };
  return {
    state: { defaults: withImage },
    require: ((plugin: { name: string }) => byName[plugin.name]) as ApiContext["require"]
  };
}

describe("head api", () => {
  describe("validateHeadConfig()", () => {
    it("accepts a titleTemplate containing %s", () => {
      expect(() => validateHeadConfig({ titleTemplate: "%s — Site" })).not.toThrow();
    });

    it("throws [web] head: ... when titleTemplate lacks %s", () => {
      expect(() => validateHeadConfig({ titleTemplate: "Site" })).toThrow(/\[web\] head:/);
    });

    it("accepts the two valid twitterCard literals", () => {
      expect(() => validateHeadConfig({ twitterCard: "summary" })).not.toThrow();
      expect(() => validateHeadConfig({ twitterCard: "summary_large_image" })).not.toThrow();
    });

    it("throws [web] head: ... for an invalid twitterCard", () => {
      // @ts-expect-error — exercising the runtime guard with an invalid literal
      expect(() => validateHeadConfig({ twitterCard: "huge" })).toThrow(/\[web\] head:/);
    });

    it("accepts an empty config", () => {
      expect(() => validateHeadConfig({})).not.toThrow();
    });
  });

  describe("normalizeHeadConfig()", () => {
    it("defaults twitterCard to summary_large_image", () => {
      expect(normalizeHeadConfig({}).twitterCard).toBe("summary_large_image");
    });

    it("carries through provided fields", () => {
      const d = normalizeHeadConfig({
        titleTemplate: "%s — X",
        defaultOgImage: "/og.png",
        twitterCard: "summary",
        twitterHandle: "@x"
      });
      expect(d).toMatchObject({
        titleTemplate: "%s — X",
        defaultOgImage: "/og.png",
        twitterCard: "summary",
        twitterHandle: "@x"
      });
    });

    it("returns a frozen snapshot", () => {
      expect(Object.isFrozen(normalizeHeadConfig({}))).toBe(true);
    });

    it("throws on invalid config (delegates to validation)", () => {
      expect(() => normalizeHeadConfig({ titleTemplate: "no token" })).toThrow(/\[web\] head:/);
    });
  });

  describe("createApi().render()", () => {
    it("returns a serialized <head> inner HTML string", () => {
      const api = createApi(makeCtx());
      const route: ResolvedRoute = {
        path: "/post/",
        params: {},
        locale: "en",
        name: "article",
        head: { title: "Hello", description: "Desc" }
      };
      const html = api.render(route, {});
      expect(html).toContain("<title>Hello</title>");
      expect(html).toContain('name="description"');
      expect(html).toContain("Desc");
      expect(html).toContain('rel="canonical"');
    });

    it("resolves deps via ctx.require at call time", () => {
      const api = createApi(makeCtx());
      const route: ResolvedRoute = { path: "/", params: {}, name: "home", head: {} };
      expect(() => api.render(route, {})).not.toThrow();
    });
  });

  describe("createApi().siteHead()", () => {
    it("returns '' when no defaultOgImage is configured", () => {
      const api = createApi(makeCtx()); // DEFAULTS has no defaultOgImage
      expect(api.siteHead({ url: "/en/", locale: "en" })).toBe("");
    });

    it("absolutizes the url (og:url) against the site base and emits the default image", () => {
      const api = createApi(makeCtxWithImage());
      const html = api.siteHead({ url: "/en/", locale: "en" });
      expect(html).toContain('<meta property="og:url" content="https://blog.dev/en/">');
      expect(html).toContain(
        '<meta property="og:image" content="https://blog.dev/og-default.png">'
      );
      expect(html).toContain('<meta property="og:type" content="website">');
    });

    it("emits og:locale from i18n when a locale is supplied", () => {
      const api = createApi(makeCtxWithImage());
      expect(api.siteHead({ url: "/en/", locale: "en" })).toContain(
        '<meta property="og:locale" content="en_US">'
      );
    });

    it("omits og:locale when no locale is supplied", () => {
      const api = createApi(makeCtxWithImage());
      expect(api.siteHead({ url: "/en/" })).not.toContain("og:locale");
    });
  });
});
