import { describe, expect, it } from "vitest";
import {
  buildArticleHead,
  canonical,
  feedLink,
  hreflang,
  jsonLd,
  meta,
  og,
  twitter
} from "../../primitives";

describe("head primitives", () => {
  it("meta() builds a <meta name content> descriptor", () => {
    expect(meta("description", "Hello")).toEqual({
      tag: "meta",
      attrs: { name: "description", content: "Hello" },
      key: "meta:description"
    });
  });

  it("og() builds an Open Graph <meta property content> descriptor with the property verbatim", () => {
    expect(og("og:title", "Home")).toEqual({
      tag: "meta",
      attrs: { property: "og:title", content: "Home" },
      key: "meta:og:title"
    });
  });

  it("twitter() builds a Twitter-card <meta name content> descriptor with the name verbatim", () => {
    expect(twitter("twitter:card", "summary_large_image")).toEqual({
      tag: "meta",
      attrs: { name: "twitter:card", content: "summary_large_image" },
      key: "meta:twitter:card"
    });
  });

  it("canonical() builds a <link rel=canonical> descriptor", () => {
    expect(canonical("https://example.com/post")).toEqual({
      tag: "link",
      attrs: { rel: "canonical", href: "https://example.com/post" },
      key: "link:canonical"
    });
  });

  it("hreflang() builds a <link rel=alternate hreflang> descriptor", () => {
    expect(hreflang("uk", "https://example.com/uk/post")).toEqual({
      tag: "link",
      attrs: { rel: "alternate", hreflang: "uk", href: "https://example.com/uk/post" },
      key: "link:alternate:uk"
    });
  });

  it("feedLink() defaults the type to application/rss+xml", () => {
    expect(feedLink("My Blog", "/feed.xml")).toEqual({
      tag: "link",
      attrs: {
        rel: "alternate",
        type: "application/rss+xml",
        title: "My Blog",
        href: "/feed.xml"
      },
      key: "link:feed:/feed.xml"
    });
  });

  it("feedLink() honors an explicit type", () => {
    const el = feedLink("My Blog", "/feed.atom", "application/atom+xml");
    expect(el.attrs?.type).toBe("application/atom+xml");
  });

  describe("jsonLd()", () => {
    it("emits a <script type=application/ld+json> descriptor", () => {
      const el = jsonLd({ "@type": "Article", headline: "Hi" });
      expect(el.tag).toBe("script");
      expect(el.attrs).toEqual({ type: "application/ld+json" });
    });

    it("unicode-escapes < > & so </script> cannot break out", () => {
      const el = jsonLd({ html: "</script><!-- x & y -->" });
      const json = el.children ?? "";
      expect(json).not.toContain("<");
      expect(json).not.toContain(">");
      expect(json).toContain(String.raw`\u003c`);
      expect(json).toContain(String.raw`\u003e`);
      expect(json).toContain(String.raw`\u0026`);
    });

    it("round-trips back to the original object via JSON.parse", () => {
      const data = {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: "A & B </script>"
      };
      const el = jsonLd(data);
      expect(JSON.parse(el.children ?? "")).toEqual(data);
    });
  });

  describe("buildArticleHead()", () => {
    it("emits the full element set: og:type, dates, author, section, tags, canonical, JSON-LD", () => {
      const elements = buildArticleHead(
        {
          title: "Hi",
          description: "Desc",
          author: "Alex",
          published: "2026-01-01",
          modified: "2026-02-02",
          section: "Tech",
          tags: ["a", "b"],
          image: "https://x/img.png"
        },
        "https://x/p"
      );
      const props = elements
        .filter(e => e.tag === "meta")
        .map(e => e.attrs?.property ?? e.attrs?.name);
      expect(props).toContain("og:type");
      expect(props).toContain("article:published_time");
      expect(props).toContain("article:modified_time");
      expect(props).toContain("article:author");
      expect(props).toContain("article:section");
      expect(props).toContain("article:tag");
      // canonical link present
      expect(elements.some(e => e.tag === "link" && e.attrs?.rel === "canonical")).toBe(true);
      // JSON-LD Article block present
      const ld = elements.find(e => e.tag === "script");
      expect(ld).toBeDefined();
      const parsed = JSON.parse(ld?.children ?? "{}");
      expect(parsed["@type"]).toBe("Article");
      expect(parsed.headline).toBe("Hi");
    });

    it("emits one og:type=article meta", () => {
      const elements = buildArticleHead({ title: "Hi" }, "https://x/p");
      const ogType = elements.find(e => e.attrs?.property === "og:type");
      expect(ogType?.attrs?.content).toBe("article");
    });

    it("emits one article:tag meta per tag", () => {
      const elements = buildArticleHead({ title: "Hi", tags: ["x", "y", "z"] }, "https://x/p");
      const tags = elements.filter(e => e.attrs?.property === "article:tag");
      expect(tags.map(t => t.attrs?.content)).toEqual(["x", "y", "z"]);
    });

    it("omits optional metas that are not provided", () => {
      const elements = buildArticleHead({ title: "Hi" }, "https://x/p");
      const props = elements.map(e => e.attrs?.property);
      expect(props).not.toContain("article:author");
      expect(props).not.toContain("article:section");
      expect(props).not.toContain("article:published_time");
    });
  });
});
