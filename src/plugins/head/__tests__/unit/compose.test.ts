import { describe, expect, it } from "vitest";
import type { ComposeInput, SiteHeadInput } from "../../compose";
import { composeHead, composeSiteHead, composeTitle, serializeHead } from "../../compose";
import { meta } from "../../primitives";
import type { HeadDefaults, HeadElement, ResolvedRoute } from "../../types";

/** A site API stub matching the slice composeHead reads. */
function makeSite() {
  return {
    name: () => "My Site",
    url: () => "https://blog.dev",
    author: () => "Alex",
    description: () => "Site description",
    canonical: (path: string) => `https://blog.dev${path}`
  };
}

/** An i18n API stub matching the slice composeHead reads. */
function makeI18n() {
  return {
    locales: () => ["en", "uk"] as readonly string[],
    defaultLocale: () => "en",
    isLocale: (x: string) => ["en", "uk"].includes(x),
    localeName: (l: string) => ({ en: "English", uk: "Українська" })[l],
    ogLocale: (l: string) => ({ en: "en_US", uk: "uk_UA" })[l],
    t: (_l: string, key: string) => key
  };
}

/** A router API stub: toUrl substitutes a lang param into the path. */
function makeRouter() {
  return {
    toUrl: (_name: string, params: Record<string, string>) => {
      const lang = params.lang;
      return lang ? `/${lang}/post/` : "/post/";
    }
  };
}

const DEFAULTS: HeadDefaults = {
  titleTemplate: "%s — My Site",
  defaultOgImage: "/default-og.png",
  twitterCard: "summary_large_image",
  twitterHandle: "@moku_labs"
};

/** Build a ComposeInput with sensible defaults + overrides. */
function input(overrides: Partial<ComposeInput> = {}): ComposeInput {
  const route: ResolvedRoute = {
    path: "/post/",
    params: { lang: "en" },
    locale: "en",
    name: "article",
    head: { title: "Hello", description: "Hello desc" }
  };
  return {
    route,
    data: {},
    defaults: DEFAULTS,
    site: makeSite(),
    i18n: makeI18n(),
    router: makeRouter(),
    ...overrides
  };
}

/** Pluck the x-default alternate's href from a composed element set. */
function xDefaultHref(els: HeadElement[]): string | undefined {
  return els.find(e => e.attrs?.hreflang === "x-default")?.attrs?.href;
}

/** Build a SiteHeadInput with sensible defaults + overrides (for composeSiteHead tests). */
function siteInput(overrides: Partial<SiteHeadInput> = {}): SiteHeadInput {
  return {
    site: makeSite(),
    defaults: DEFAULTS,
    url: "https://blog.dev/en/",
    ogLocale: "en_US",
    ...overrides
  };
}

describe("head compose", () => {
  describe("composeHead()", () => {
    it("applies the titleTemplate %s to the route title", () => {
      const els = composeHead(input());
      const title = els.find(e => e.tag === "title");
      expect(title?.children).toBe("Hello — My Site");
    });

    it("falls back to the site name when the route supplies no title", () => {
      const els = composeHead(input({ route: { path: "/", params: {}, name: "home", head: {} } }));
      const title = els.find(e => e.tag === "title");
      expect(title?.children).toBe("My Site — My Site");
    });

    it("emits a description meta from the route head", () => {
      const els = composeHead(input());
      const desc = els.find(e => e.key === "meta:description");
      expect(desc?.attrs?.content).toBe("Hello desc");
    });

    it("falls back to the site description when the route omits it", () => {
      const els = composeHead(
        input({ route: { path: "/", params: {}, name: "home", head: { title: "X" } } })
      );
      const desc = els.find(e => e.key === "meta:description");
      expect(desc?.attrs?.content).toBe("Site description");
    });

    it("emits og:title/og:description merged from defaults + route", () => {
      const els = composeHead(input());
      const ogTitle = els.find(e => e.key === "meta:og:title");
      const ogDesc = els.find(e => e.key === "meta:og:description");
      expect(ogTitle?.attrs?.content).toBe("Hello");
      expect(ogDesc?.attrs?.content).toBe("Hello desc");
    });

    it("uses the route image override for og:image, else the default og image", () => {
      const withOverride = composeHead(
        input({
          route: {
            path: "/post/",
            params: { lang: "en" },
            name: "article",
            head: { image: "/custom.png" }
          }
        })
      );
      expect(withOverride.find(e => e.key === "meta:og:image")?.attrs?.content).toBe(
        "https://blog.dev/custom.png"
      );
      const withDefault = composeHead(input());
      expect(withDefault.find(e => e.key === "meta:og:image")?.attrs?.content).toBe(
        "https://blog.dev/default-og.png"
      );
    });

    it("emits the configured twitter:card and twitter:site handle", () => {
      const els = composeHead(input());
      expect(els.find(e => e.key === "meta:twitter:card")?.attrs?.content).toBe(
        "summary_large_image"
      );
      expect(els.find(e => e.key === "meta:twitter:site")?.attrs?.content).toBe("@moku_labs");
    });

    it("builds the canonical link from router.toUrl + site base URL", () => {
      const els = composeHead(input());
      const link = els.find(e => e.key === "link:canonical");
      expect(link?.attrs?.href).toBe("https://blog.dev/en/post/");
    });

    it("honors a route canonical override", () => {
      const els = composeHead(
        input({
          route: {
            path: "/post/",
            params: { lang: "en" },
            name: "article",
            head: { canonical: "https://other.dev/x" }
          }
        })
      );
      expect(els.find(e => e.key === "link:canonical")?.attrs?.href).toBe("https://other.dev/x");
    });

    it("emits an hreflang alternate for every locale plus x-default", () => {
      const els = composeHead(input());
      const alternates = els.filter(e => e.attrs?.rel === "alternate" && e.attrs?.hreflang);
      const langs = alternates.map(e => e.attrs?.hreflang);
      expect(langs).toContain("en");
      expect(langs).toContain("uk");
      expect(langs).toContain("x-default");
      // hrefs are absolute, built via router.toUrl per locale + site base.
      const uk = alternates.find(e => e.attrs?.hreflang === "uk");
      expect(uk?.attrs?.href).toBe("https://blog.dev/uk/post/");
    });

    it("declares a byte-identical x-default across locale variants of the same route", () => {
      // Default-locale ("en") variant and non-default ("uk") variant of the same route.
      const enEls = composeHead(input());
      const ukEls = composeHead(
        input({
          route: {
            path: "/uk/post/",
            params: { lang: "uk" },
            locale: "uk",
            name: "article",
            head: { title: "Hello", description: "Hello desc" }
          }
        })
      );

      // x-default is the bare URL (lang stripped), NOT the page's own locale URL.
      expect(xDefaultHref(enEls)).toBe("https://blog.dev/post/");
      expect(xDefaultHref(ukEls)).toBe("https://blog.dev/post/");
      expect(xDefaultHref(ukEls)).toBe(xDefaultHref(enEls));
    });

    it("merges route elements and de-duplicates by key (later wins)", () => {
      const els = composeHead(
        input({
          route: {
            path: "/post/",
            params: { lang: "en" },
            name: "article",
            head: {
              title: "Hello",
              elements: [meta("description", "Overridden description"), meta("robots", "noindex")]
            }
          }
        })
      );
      const descs = els.filter(e => e.key === "meta:description");
      expect(descs).toHaveLength(1);
      expect(descs[0]?.attrs?.content).toBe("Overridden description");
      expect(els.find(e => e.key === "meta:robots")?.attrs?.content).toBe("noindex");
    });

    it("emits og:locale for the active locale", () => {
      const els = composeHead(input());
      expect(els.find(e => e.key === "meta:og:locale")?.attrs?.content).toBe("en_US");
    });
  });

  describe("composeTitle()", () => {
    it("applies the titleTemplate to the route title (matches composeHead's <title>)", () => {
      expect(composeTitle({ title: "Page 2" }, DEFAULTS, makeSite())).toBe("Page 2 — My Site");
    });

    it("falls back to the site name for an undefined head config", () => {
      expect(composeTitle(undefined, DEFAULTS, makeSite())).toBe("My Site — My Site");
    });

    it("returns the title verbatim when no titleTemplate is configured", () => {
      const defaults: HeadDefaults = {
        defaultOgImage: "/default-og.png",
        twitterCard: "summary_large_image",
        twitterHandle: "@moku_labs"
      };
      expect(composeTitle({ title: "Page 2" }, defaults, makeSite())).toBe("Page 2");
    });

    it("lets a route-pinned `title` element win over the template (last-wins de-dupe)", () => {
      const head = {
        title: "My Site",
        elements: [{ tag: "title", children: "My Site", key: "title" } as HeadElement]
      };
      expect(composeTitle(head, DEFAULTS, makeSite())).toBe("My Site");
    });

    it("agrees with composeHead's emitted <title> element", () => {
      const composeInput = input();
      const fromHead = composeHead(composeInput).find(e => e.key === "title")?.children;
      const fromTitle = composeTitle(composeInput.route.head, DEFAULTS, makeSite());
      expect(fromTitle).toBe(fromHead);
    });
  });

  describe("serializeHead()", () => {
    it("serializes a title element with escaped text", () => {
      const html = serializeHead([{ tag: "title", children: "A & B <x>" }]);
      expect(html).toBe("<title>A &amp; B &lt;x&gt;</title>");
    });

    it("HTML-attribute-escapes attribute values", () => {
      const html = serializeHead([
        { tag: "meta", attrs: { name: "description", content: 'He said "hi" & <b>' } }
      ]);
      expect(html).toContain('content="He said &quot;hi&quot; &amp; &lt;b&gt;"');
    });

    it("emits a self-contained void tag for meta/link", () => {
      const html = serializeHead([
        { tag: "link", attrs: { rel: "canonical", href: "https://x/" } }
      ]);
      expect(html).toBe('<link rel="canonical" href="https://x/">');
    });

    it("emits script children verbatim (jsonLd already unicode-escaped)", () => {
      const html = serializeHead([
        {
          tag: "script",
          attrs: { type: "application/ld+json" },
          children: String.raw`{"a":"\u003c"}`
        }
      ]);
      expect(html).toBe(String.raw`<script type="application/ld+json">{"a":"\u003c"}</script>`);
    });

    it("joins multiple elements", () => {
      const html = serializeHead([
        { tag: "title", children: "Hi" },
        { tag: "meta", attrs: { name: "robots", content: "index" } }
      ]);
      expect(html).toContain("<title>Hi</title>");
      expect(html).toContain('<meta name="robots" content="index">');
    });
  });

  describe("composeSiteHead()", () => {
    it("returns [] when no defaultOgImage is configured (opt-out keeps a bare redirect)", () => {
      const elements = composeSiteHead(
        siteInput({ defaults: { twitterCard: "summary_large_image" } })
      );
      expect(elements).toEqual([]);
    });

    it("emits og:type=website with the site name + description as the card", () => {
      const html = serializeHead(composeSiteHead(siteInput()));
      expect(html).toContain('<meta property="og:type" content="website">');
      expect(html).toContain('<meta property="og:site_name" content="My Site">');
      expect(html).toContain('<meta property="og:title" content="My Site">');
      expect(html).toContain('<meta property="og:description" content="Site description">');
      expect(html).toContain('<meta property="og:url" content="https://blog.dev/en/">');
    });

    it("absolutizes a relative defaultOgImage against the site base for og + twitter", () => {
      const html = serializeHead(composeSiteHead(siteInput()));
      expect(html).toContain(
        '<meta property="og:image" content="https://blog.dev/default-og.png">'
      );
      expect(html).toContain(
        '<meta name="twitter:image" content="https://blog.dev/default-og.png">'
      );
    });

    it("passes an absolute defaultOgImage through unchanged", () => {
      const html = serializeHead(
        composeSiteHead(
          siteInput({
            defaults: { twitterCard: "summary", defaultOgImage: "https://cdn.example/og.png" }
          })
        )
      );
      expect(html).toContain('<meta property="og:image" content="https://cdn.example/og.png">');
    });

    it("emits twitter:card + twitter:site (handle) and og:locale when provided", () => {
      const html = serializeHead(composeSiteHead(siteInput()));
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(html).toContain('<meta name="twitter:site" content="@moku_labs">');
      expect(html).toContain('<meta property="og:locale" content="en_US">');
    });

    it("omits og:locale when no ogLocale is supplied", () => {
      // Built directly (not via siteInput) so the optional `ogLocale` is truly absent.
      const html = serializeHead(
        composeSiteHead({ site: makeSite(), defaults: DEFAULTS, url: "https://blog.dev/en/" })
      );
      expect(html).not.toContain("og:locale");
    });
  });
});
