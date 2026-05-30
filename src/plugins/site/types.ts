/**
 * @file site plugin — public type definitions (Config + Api).
 */

/**
 * Configuration for the site plugin — global, frozen site metadata.
 *
 * All four fields are required at runtime. The framework ships empty-string
 * defaults and `onInit` fails fast (at `createApp`) if `name` is blank or
 * `url` is not a valid absolute URL. Consumers MUST supply real values via
 * `pluginConfigs.site`.
 *
 * @example
 * ```ts
 * createApp({
 *   pluginConfigs: {
 *     site: {
 *       name: "My Blog",
 *       url: "https://blog.dev",
 *       author: "Alex",
 *       description: "A personal blog about web frameworks."
 *     }
 *   }
 * });
 * ```
 */
export type Config = {
  /** Human-readable site name. Used in feeds, og:site_name, and titles. MUST be non-empty. */
  name: string;
  /** Absolute base URL of the site, e.g. "https://blog.dev". MUST be a valid absolute URL (http/https). */
  url: string;
  /** Default author/byline for the site. Used in feeds and article author meta. */
  author: string;
  /** Short site description. Used in feeds, the default meta description, and og:description fallbacks. */
  description: string;
};

/**
 * Public API of the site plugin — read-only accessors over frozen global
 * site metadata, plus canonical URL construction.
 */
export type Api = {
  /**
   * Returns the configured site name.
   *
   * @returns {string} The human-readable site name from `config.name`.
   * @example
   * ```ts
   * app.site.name(); // "My Blog"
   * ```
   */
  name: () => string;
  /**
   * Returns the configured absolute base URL of the site.
   *
   * @returns {string} The base URL from `config.url`, e.g. "https://blog.dev".
   * @example
   * ```ts
   * app.site.url(); // "https://blog.dev"
   * ```
   */
  url: () => string;
  /**
   * Returns the configured site author/byline.
   *
   * @returns {string} The author from `config.author`.
   * @example
   * ```ts
   * app.site.author(); // "Alex"
   * ```
   */
  author: () => string;
  /**
   * Returns the configured site description.
   *
   * @returns {string} The description from `config.description`.
   * @example
   * ```ts
   * app.site.description(); // "A personal blog about web frameworks."
   * ```
   */
  description: () => string;
  /**
   * Joins a path against the configured base `url` to produce an absolute
   * canonical URL. An empty path (or "/") returns the base URL unchanged.
   *
   * @param {string} path - Relative path for the page, e.g. "/about/" or "blog/post/".
   * @returns {string} The absolute canonical URL, e.g. "https://blog.dev/about/".
   * @example
   * ```ts
   * app.site.canonical("/about/"); // "https://blog.dev/about/"
   * app.site.canonical("/");       // "https://blog.dev"
   * ```
   */
  canonical: (path: string) => string;
};
