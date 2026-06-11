/**
 * @file head plugin — type definitions skeleton
 */

/**
 * Configuration for the `head` plugin.
 *
 * All fields are optional; sensible empty/identity defaults apply. Site-level values
 * (title, description, base URL) are owned by the `site` plugin and read at render time.
 *
 * @example
 * ```ts
 * const config: Config = { titleTemplate: "%s — Moku" };
 * ```
 */
export type Config = {
  /** Title template applied to per-route titles. `%s` is replaced by the route title. */
  titleTemplate?: string;
  /** Default Open Graph image URL used when a route does not supply one. */
  defaultOgImage?: string;
  /** Default Twitter card type emitted when og/twitter content is present. */
  twitterCard?: "summary" | "summary_large_image";
  /** Default Twitter site handle (e.g. `"@moku_labs"`) emitted as `twitter:site`. */
  twitterHandle?: string;
};

/**
 * Internal head state: a single `defaults` slot holding the normalized head defaults.
 *
 * `createState` initializes `defaults` to `null`; `onInit` assigns the normalized snapshot
 * exactly once. The field is mutable (assigned in `onInit`) and nullable (initial value
 * before `onInit`).
 *
 * @example
 * ```ts
 * const state: State = { defaults: null };
 * ```
 */
export type State = {
  /** Normalized head defaults, assigned once in `onInit` (initially `null`). */
  defaults: HeadDefaults | null;
};

/**
 * The normalized, resolved head defaults snapshot built from `Config` in `onInit` and
 * read by `render`.
 *
 * @example
 * ```ts
 * const defaults: HeadDefaults = { twitterCard: "summary_large_image" };
 * ```
 */
export type HeadDefaults = {
  /** Title template carried over from config (validated to contain `%s`). */
  readonly titleTemplate?: string;
  /** Default Open Graph image URL. */
  readonly defaultOgImage?: string;
  /** Resolved Twitter card type (defaulted to `"summary_large_image"`). */
  readonly twitterCard: "summary" | "summary_large_image";
  /** Default Twitter site handle. */
  readonly twitterHandle?: string;
};

/**
 * A serializable descriptor for a single `<head>` tag.
 *
 * Deliberately a PLAIN serializable object (NOT a Preact `VNode`) so `head` stays
 * decoupled from any renderer and can be produced/consumed in build (string) and in the
 * SPA (DOM) without pulling in `preact`.
 *
 * @example
 * ```ts
 * const el: HeadElement = { tag: "meta", attrs: { name: "robots", content: "index" } };
 * ```
 */
export type HeadElement = {
  /** The tag name to emit. */
  tag: "meta" | "link" | "title" | "script";
  /** Attribute map (already-unescaped values; escaping happens at serialization). */
  attrs?: Record<string, string>;
  /** Inner text content (for `<title>` and JSON-LD `<script>`). */
  children?: string;
  /** Stable identity used for de-duplication during `render` (e.g. `"meta:description"`). */
  key?: string;
};

/**
 * The shape returned by a route's `.head(data)` callback. All fields optional so routes
 * supply only what they override.
 *
 * @example
 * ```ts
 * const head: HeadConfig = { title: "Home", description: "Welcome" };
 * ```
 */
export type HeadConfig = {
  /** Page title (before `titleTemplate` is applied). */
  title?: string;
  /** Page description (`<meta name=description>` + og/twitter fallback). */
  description?: string;
  /** Canonical URL override (otherwise derived from `router.toUrl`). */
  canonical?: string;
  /** Open Graph image override for this page. */
  image?: string;
  /** Arbitrary extra head elements (use the SEO primitive helpers to build these). */
  elements?: HeadElement[];
};

/**
 * Metadata describing an article page, consumed by `buildArticleHead`.
 *
 * @example
 * ```ts
 * const meta: ArticleMeta = { title: "Hi", author: "A", published: "2026-01-01" };
 * ```
 */
export type ArticleMeta = {
  /** Article title. */
  title: string;
  /** Article description. */
  description?: string;
  /** Article author. */
  author?: string;
  /** ISO 8601 publish date. */
  published?: string;
  /** ISO 8601 last-modified date. */
  modified?: string;
  /** Section/category. */
  section?: string;
  /** Article tags. */
  tags?: string[];
  /** Article image URL. */
  image?: string;
};

/**
 * A resolved route descriptor passed to `render` (path, params, locale, and its `.head()`
 * result as a `HeadConfig`).
 *
 * @example
 * ```ts
 * const route: ResolvedRoute = { path: "/about", params: {}, name: "about" };
 * ```
 */
export type ResolvedRoute = {
  /** The resolved path of the route. */
  path: string;
  /** The route name key (used by `router.toUrl` for canonical/alternate hrefs). */
  name: string;
  /** Resolved route params. */
  params: Record<string, string>;
  /** The active locale for this route render. */
  locale?: string;
  /** The route's `.head()` result. */
  head?: HeadConfig;
};

/**
 * The public API surface of the `head` plugin.
 *
 * @example
 * ```ts
 * const html: string = api.render(route, data);
 * ```
 */
export type Api = {
  /**
   * Compose the final `<head>` inner HTML for a route. Pulled synchronously by `build`.
   *
   * @param route - The resolved route descriptor (incl. its `.head()` HeadConfig).
   * @param data - The page data object passed to the route's loader/render.
   * @returns The serialized inner HTML of `<head>` (no surrounding `<head>` tags).
   * @example
   * ```ts
   * api.render(route, data);
   * ```
   */
  render(route: ResolvedRoute, data: unknown): string;
  /**
   * Compose the SITE-LEVEL `<head>` Open Graph / Twitter block for a bare-path redirect or
   * landing page that has no route identity (e.g. the apex-domain `/` redirect a
   * `localeRedirects` build emits). Returns `""` UNLESS `defaultOgImage` is configured, so
   * apps that opt out keep a bare redirect. Pulled synchronously by `build`.
   *
   * @param input - The landing URL (resolved to an absolute canonical) plus an optional locale.
   * @param input.url - The page's URL or path (absolutized via `site.canonical`) → `og:url`.
   * @param input.locale - Optional locale whose `og:locale` is emitted (e.g. the default locale).
   * @returns The serialized inner HTML of the site-level head block, or `""` when disabled.
   * @example
   * ```ts
   * api.siteHead({ url: "/en/", locale: "en" });
   * ```
   */
  siteHead(input: { url: string; locale?: string }): string;
  /**
   * Resolve the FINAL document title for a route's head config — the same value `render`
   * emits in its `<title>` element (`titleTemplate` applied; a route-pinned `title`-keyed
   * element wins). Used by `spa` to sync `document.title` on client DATA-path navigation.
   *
   * @param head - The route's head config (may be `undefined` for head-less routes).
   * @returns The final document title string.
   * @example
   * ```ts
   * api.composeTitle({ title: "Page 2" }); // "Page 2 — Site"
   * ```
   */
  composeTitle(head: HeadConfig | undefined): string;
};
