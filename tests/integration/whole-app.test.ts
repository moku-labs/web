/**
 * @file Integration scenario 0 — the framework boots end-to-end.
 *
 * The per-plugin suites rebuild a private `web-test` core; this asserts the REAL
 * shipped `createApp` (canonical 8 regular plugins + log/env core) constructs and
 * exposes its accessor surface, fails fast on missing required config, boots for
 * several site shapes, and re-exports the consumer helper surface a migrating app
 * relies on.
 */
import { describe, expect, it } from "vitest";
import {
  buildArticleHead,
  canonical,
  createApp,
  createPlugin,
  defineRoutes,
  feedLink,
  hreflang,
  jsonLd,
  meta,
  og,
  route,
  twitter
} from "../../src";
import { FIXTURE_CONTENT_DIR, SITE } from "./helpers/harness";

/** Minimal valid config for the real createApp (site + non-empty routes + contentDir). */
function bootConfig(routes: ReturnType<typeof defineRoutes>, mode: "ssg" | "spa" | "hybrid") {
  return {
    pluginConfigs: {
      site: SITE,
      i18n: { locales: ["en"], defaultLocale: "en" },
      router: { routes, mode },
      content: { contentDir: FIXTURE_CONTENT_DIR }
    }
  };
}

describe("integration: framework boots (whole app)", () => {
  it("constructs through the real factory chain and exposes accessor surfaces", () => {
    const routes = defineRoutes({ home: route("/"), post: route("/{slug}/") });
    const app = createApp(bootConfig(routes, "ssg"));

    // site
    expect(app.site.name()).toBe(SITE.name);
    expect(app.site.url()).toBe(SITE.url);
    expect(app.site.canonical("/x/")).toBe(`${SITE.url}/x/`);
    // i18n
    expect(app.i18n.locales()).toEqual(["en"]);
    expect(app.i18n.defaultLocale()).toBe("en");
    // router
    expect(app.router.manifest().map(d => d.pattern)).toEqual(["/", "/{slug}/"]);
    // build introspection (no run)
    expect(app.build.phases()).toContain("pages");
  });

  it("fails fast on `createApp({})` with the [web] site.name error", () => {
    expect(() => createApp({})).toThrow("[web] site.name is required.");
  });

  it("fails fast on an empty route map", () => {
    expect(() =>
      createApp({
        pluginConfigs: {
          site: SITE,
          content: { contentDir: FIXTURE_CONTENT_DIR },
          router: { routes: defineRoutes({}), mode: "ssg" }
        }
      })
    ).toThrow(/\[web\]/);
  });

  // Different "site variants" all boot through the same shipped wiring.
  const variants: Array<{
    name: string;
    routes: ReturnType<typeof defineRoutes>;
    patterns: string[];
  }> = [
    {
      name: "blog",
      routes: defineRoutes({ home: route("/"), post: route("/{slug}/") }),
      patterns: ["/", "/{slug}/"]
    },
    {
      name: "docs",
      routes: defineRoutes({ home: route("/"), doc: route("/docs/{slug}/") }),
      patterns: ["/", "/docs/{slug}/"]
    },
    { name: "landing", routes: defineRoutes({ home: route("/") }), patterns: ["/"] }
  ];

  it.each(variants)("boots the $name site variant with the expected route manifest", ({
    routes,
    patterns
  }) => {
    const app = createApp(bootConfig(routes, "hybrid"));
    expect(app.router.manifest().map(d => d.pattern)).toEqual(patterns);
  });

  it("re-exports the consumer helper surface (what a migrating app imports)", () => {
    for (const fn of [
      createApp,
      createPlugin,
      route,
      defineRoutes,
      meta,
      og,
      twitter,
      jsonLd,
      canonical,
      hreflang,
      feedLink,
      buildArticleHead
    ]) {
      expect(typeof fn).toBe("function");
    }
    // The SEO primitives return serializable head elements.
    expect(meta("description", "hi")).toMatchObject({ tag: "meta" });
    expect(canonical("https://blog.moku.dev/")).toMatchObject({ tag: "link" });
  });
});
