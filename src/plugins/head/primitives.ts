/**
 * @file head plugin — pure SEO primitive helpers (re-exported at framework index)
 */
import type { ArticleMeta, HeadElement } from "./types";

/**
 * Build a `<meta name=… content=…>` descriptor.
 *
 * @param _name - The meta `name` attribute (e.g. `"description"`, `"robots"`).
 * @param _content - The meta `content` value.
 * @example meta("description", "A web framework built on @moku-labs/core")
 */
export function meta(_name: string, _content: string): HeadElement {
  throw new Error("not implemented");
}

/**
 * Build an Open Graph `<meta property=… content=…>` descriptor.
 *
 * @param _property - The OG property (e.g. `"og:title"`, `"og:image"`).
 * @param _content - The property value.
 * @example og("og:title", "Home")
 */
export function og(_property: string, _content: string): HeadElement {
  throw new Error("not implemented");
}

/**
 * Build a Twitter-card `<meta name=… content=…>` descriptor.
 *
 * @param _name - The Twitter meta name (e.g. `"twitter:title"`).
 * @param _content - The value.
 * @example twitter("twitter:card", "summary_large_image")
 */
export function twitter(_name: string, _content: string): HeadElement {
  throw new Error("not implemented");
}

/**
 * Build a JSON-LD `<script type="application/ld+json">` descriptor.
 *
 * XSS-SAFE: the serialized JSON has `<`, `>`, and `&` unicode-escaped so the payload can
 * never break out of the `<script>` element or inject markup.
 *
 * @param _data - Any JSON-serializable structured-data object.
 * @example jsonLd({ "@context": "https://schema.org", "@type": "Article", headline: "Hi" })
 */
export function jsonLd(_data: unknown): HeadElement {
  throw new Error("not implemented");
}

/**
 * Build a canonical `<link rel="canonical" href=…>` descriptor.
 *
 * @param _url - The canonical absolute URL.
 * @example canonical("https://example.com/post")
 */
export function canonical(_url: string): HeadElement {
  throw new Error("not implemented");
}

/**
 * Build an alternate-language `<link rel="alternate" hreflang=… href=…>` descriptor.
 *
 * @param _locale - The BCP-47 locale tag (e.g. `"en"`, `"uk"`, `"x-default"`).
 * @param _url - The absolute URL of the localized page.
 * @example hreflang("uk", "https://example.com/uk/post")
 */
export function hreflang(_locale: string, _url: string): HeadElement {
  throw new Error("not implemented");
}

/**
 * Build a feed `<link rel="alternate" type=… title=… href=…>` descriptor.
 *
 * @param _title - Human-readable feed title.
 * @param _url - The feed URL.
 * @param _type - The feed MIME type. Defaults to `"application/rss+xml"`.
 * @example feedLink("My Blog", "/feed.xml", "application/atom+xml")
 */
export function feedLink(_title: string, _url: string, _type?: string): HeadElement {
  throw new Error("not implemented");
}

/**
 * Compose the full head element set for an article page: og:type=article, published/
 * modified times, author, section, tags, plus a JSON-LD `Article` block and canonical.
 *
 * @param _articleMeta - Article metadata (title, description, author, dates, tags, image…).
 * @param _canonicalUrl - The article's canonical absolute URL.
 * @example buildArticleHead({ title: "Hi", author: "A", published: "2026-01-01" }, "https://x/p")
 */
export function buildArticleHead(_articleMeta: ArticleMeta, _canonicalUrl: string): HeadElement[] {
  throw new Error("not implemented");
}
