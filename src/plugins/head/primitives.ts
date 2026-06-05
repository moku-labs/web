/**
 * @file head plugin — pure SEO primitive helpers (re-exported at framework index)
 *
 * Each helper is a pure, context-free function returning a plain serializable
 * `HeadElement` (or `HeadElement[]` for `buildArticleHead`). They carry stable
 * `key`s so `render`/`composeHead` can de-duplicate later elements over earlier ones.
 */
import type { ArticleMeta, HeadElement } from "./types";

/** OG/Twitter article-meta property prefixes (factored to satisfy no-duplicate-string). */
const ARTICLE_PREFIX = "article:";

/**
 * Build a `<meta name=… content=…>` descriptor.
 *
 * @param name - The meta `name` attribute (e.g. `"description"`, `"robots"`).
 * @param content - The meta `content` value.
 * @returns A serializable head element keyed `meta:<name>`.
 * @example meta("description", "A web framework built on @moku-labs/core")
 */
export function meta(name: string, content: string): HeadElement {
  return { tag: "meta", attrs: { name, content }, key: `meta:${name}` };
}

/**
 * Build an Open Graph `<meta property=… content=…>` descriptor.
 *
 * @param property - The OG property, used verbatim (e.g. `"og:title"`, `"og:image"`).
 * @param content - The property value.
 * @returns A serializable head element keyed `meta:<property>`.
 * @example og("og:title", "Home")
 */
export function og(property: string, content: string): HeadElement {
  return { tag: "meta", attrs: { property, content }, key: `meta:${property}` };
}

/**
 * Build a Twitter-card `<meta name=… content=…>` descriptor.
 *
 * @param name - The Twitter meta name, used verbatim (e.g. `"twitter:title"`).
 * @param content - The value.
 * @returns A serializable head element keyed `meta:<name>`.
 * @example twitter("twitter:card", "summary_large_image")
 */
export function twitter(name: string, content: string): HeadElement {
  return { tag: "meta", attrs: { name, content }, key: `meta:${name}` };
}

/**
 * Build a JSON-LD `<script type="application/ld+json">` descriptor.
 *
 * XSS-SAFE: the serialized JSON has `<`, `>`, and `&` unicode-escaped (`<`,
 * `>`, `&`) so the payload can never break out of the `<script>` element
 * or inject markup, while still round-tripping via `JSON.parse`.
 *
 * @param data - Any JSON-serializable structured-data object.
 * @returns A serializable head element carrying the escaped JSON-LD script.
 * @example jsonLd({ "@context": "https://schema.org", "@type": "Article", headline: "Hi" })
 */
export function jsonLd(data: unknown): HeadElement {
  const children = JSON.stringify(data)
    .replaceAll("<", String.raw`\u003c`)
    .replaceAll(">", String.raw`\u003e`)
    .replaceAll("&", String.raw`\u0026`);
  return { tag: "script", attrs: { type: "application/ld+json" }, children };
}

/**
 * Build a canonical `<link rel="canonical" href=…>` descriptor.
 *
 * @param url - The canonical absolute URL.
 * @returns A serializable head element keyed `link:canonical`.
 * @example canonical("https://example.com/post")
 */
export function canonical(url: string): HeadElement {
  return { tag: "link", attrs: { rel: "canonical", href: url }, key: "link:canonical" };
}

/**
 * Build an alternate-language `<link rel="alternate" hreflang=… href=…>` descriptor.
 *
 * @param locale - The BCP-47 locale tag (e.g. `"en"`, `"uk"`, `"x-default"`).
 * @param url - The absolute URL of the localized page.
 * @returns A serializable head element keyed `link:alternate:<locale>`.
 * @example hreflang("uk", "https://example.com/uk/post")
 */
export function hreflang(locale: string, url: string): HeadElement {
  return {
    tag: "link",
    attrs: { rel: "alternate", hreflang: locale, href: url },
    key: `link:alternate:${locale}`
  };
}

/**
 * Build a feed `<link rel="alternate" type=… title=… href=…>` descriptor.
 *
 * @param title - Human-readable feed title.
 * @param url - The feed URL.
 * @param type - The feed MIME type. Defaults to `"application/rss+xml"`.
 * @returns A serializable head element keyed `link:feed:<url>`.
 * @example feedLink("My Blog", "/feed.xml", "application/atom+xml")
 */
export function feedLink(title: string, url: string, type = "application/rss+xml"): HeadElement {
  return {
    tag: "link",
    attrs: { rel: "alternate", type, title, href: url },
    key: `link:feed:${url}`
  };
}

/**
 * Build the schema.org `Article` structured-data object for the JSON-LD block,
 * carrying only the fields the article actually provides (optional fields are
 * omitted rather than emitted as `undefined`).
 *
 * @param articleMeta - Article metadata (title, description, author, dates, image…).
 * @returns A JSON-serializable `Article` object ready to hand to {@link jsonLd}.
 * @example buildArticleJsonLd({ title: "Hi", author: "A", published: "2026-01-01" })
 */
function buildArticleJsonLd(articleMeta: ArticleMeta): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: articleMeta.title
  };
  if (articleMeta.description) ld.description = articleMeta.description;
  if (articleMeta.author) ld.author = articleMeta.author;
  if (articleMeta.published) ld.datePublished = articleMeta.published;
  if (articleMeta.modified) ld.dateModified = articleMeta.modified;
  if (articleMeta.image) ld.image = articleMeta.image;
  return ld;
}

/**
 * Compose the full head element set for an article page: og:type=article, published/
 * modified times, author, section, tags, plus a JSON-LD `Article` block and canonical.
 *
 * @param articleMeta - Article metadata (title, description, author, dates, tags, image…).
 *   `image`, when present, is pushed to `og:image` verbatim and must therefore be
 *   an absolute URL (this helper does not resolve relative paths against the site).
 * @param canonicalUrl - The article's canonical absolute URL.
 * @returns An ordered array of serializable head elements.
 * @example buildArticleHead({ title: "Hi", author: "A", published: "2026-01-01" }, "https://x/p")
 */
export function buildArticleHead(articleMeta: ArticleMeta, canonicalUrl: string): HeadElement[] {
  // Start from the always-present base: canonical link + og:type=article.
  const elements: HeadElement[] = [canonical(canonicalUrl), og("og:type", "article")];

  // Add the OG article meta the article actually carries (dates, author, section, tags).
  if (articleMeta.published) {
    elements.push(og(`${ARTICLE_PREFIX}published_time`, articleMeta.published));
  }
  if (articleMeta.modified) {
    elements.push(og(`${ARTICLE_PREFIX}modified_time`, articleMeta.modified));
  }
  if (articleMeta.author) elements.push(og(`${ARTICLE_PREFIX}author`, articleMeta.author));
  if (articleMeta.section) elements.push(og(`${ARTICLE_PREFIX}section`, articleMeta.section));
  for (const tag of articleMeta.tags ?? []) {
    elements.push(og(`${ARTICLE_PREFIX}tag`, tag));
  }

  // Advertise the social preview image when one is supplied.
  if (articleMeta.image) elements.push(og("og:image", articleMeta.image));

  // Close with the JSON-LD `Article` block built from the same metadata.
  elements.push(jsonLd(buildArticleJsonLd(articleMeta)));
  return elements;
}
