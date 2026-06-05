/**
 * @file site plugin — config validation + API factory and canonical-URL helpers.
 */
import type { Api, Config } from "./types";

/** Error prefix for all site lifecycle/validation failures. */
const ERROR_PREFIX = "[web]";

/** Plugin context surface (`{ config }`) consumed by the site onInit + API factory. */
type SiteContext = {
  readonly config: Config;
};

/**
 * Strips every trailing "/" from a value, so it can own the single slash that a
 * join boundary inserts.
 *
 * @param value - The string to trim (e.g. an absolute base URL).
 * @returns The value with all trailing slashes removed.
 * @example
 * ```ts
 * trimTrailingSlashes("https://blog.dev//"); // "https://blog.dev"
 * ```
 */
function trimTrailingSlashes(value: string): string {
  let trimmed = value;
  while (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
  return trimmed;
}

/**
 * Strips every leading "/" from a value, so the join boundary is the only slash
 * separating it from the base.
 *
 * @param value - The string to trim (e.g. a relative path).
 * @returns The value with all leading slashes removed.
 * @example
 * ```ts
 * trimLeadingSlashes("//about/"); // "about/"
 * ```
 */
function trimLeadingSlashes(value: string): string {
  let trimmed = value;
  while (trimmed.startsWith("/")) trimmed = trimmed.slice(1);
  return trimmed;
}

/**
 * Joins a relative path against an absolute base URL, normalizing the slash
 * boundary to exactly one "/". Returns the base unchanged for an empty or
 * root ("/") path; the supplied path's own trailing slash is preserved.
 *
 * @param base - Absolute base URL from config (may have trailing slash).
 * @param path - Relative path to join (may have leading slash).
 * @returns The joined absolute URL with no double slash at the boundary.
 * @example
 * ```ts
 * joinCanonical("https://blog.dev/", "/about/"); // "https://blog.dev/about/"
 * ```
 */
export function joinCanonical(base: string, path: string): string {
  // Normalize the base to own the join boundary's single slash.
  const trimmedBase = trimTrailingSlashes(base);

  // An empty or root path adds nothing — the base is already the canonical URL.
  if (path === "" || path === "/") return trimmedBase;

  // Strip the path's leading slashes, then join across exactly one "/".
  const trimmedPath = trimLeadingSlashes(path);
  return `${trimmedBase}/${trimmedPath}`;
}

/**
 * Validates that a string is a non-empty trimmed value.
 *
 * @param value - The value to test.
 * @returns `true` if the value is a non-empty (trimmed) string.
 * @example
 * ```ts
 * isNonEmpty("  "); // false
 * ```
 */
export function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Validates that a string is a parseable absolute http/https URL.
 *
 * @param value - The candidate URL string.
 * @returns `true` if `value` is an absolute http/https URL.
 * @example
 * ```ts
 * isAbsoluteUrl("https://blog.dev"); // true
 * ```
 */
export function isAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates the resolved config (fail-fast at `createApp`, synchronous). Throws
 * if `config.name` is empty/whitespace-only, or if `config.url` is not a valid
 * absolute http/https URL. On success, returns without side effects (the plugin
 * manages no resource). Errors use the `[web] site.<field> ...` format.
 *
 * @param ctx - Plugin context.
 * @param ctx.config - The resolved {@link Config} to validate.
 * @throws {Error} If `name` is blank or `url` is not an absolute http/https URL.
 * @example
 * ```ts
 * validateSiteConfig({ config }); // throws on blank name / bad url
 * ```
 */
export function validateSiteConfig(ctx: SiteContext): void {
  if (!isNonEmpty(ctx.config.name)) {
    throw new Error(
      `${ERROR_PREFIX} site.name is required.\n  Provide a non-empty site name in pluginConfigs.site.name.`
    );
  }
  if (!isAbsoluteUrl(ctx.config.url)) {
    throw new Error(
      `${ERROR_PREFIX} site.url must be a valid absolute URL (http/https), received ${JSON.stringify(ctx.config.url)}.\n  Provide an absolute URL in pluginConfigs.site.url, e.g. "https://blog.dev".`
    );
  }
}

/**
 * Creates the site plugin API surface — read-only accessors over frozen config
 * plus the `canonical` helper. Closures read directly from `ctx.config`; none
 * mutate or emit, and they return primitives, never internal references.
 *
 * @param ctx - Plugin context.
 * @param ctx.config - The frozen {@link Config} read by every accessor.
 * @returns The {@link Api} accessor surface mounted at `ctx.site`.
 * @example
 * ```ts
 * const api = createSiteApi({ config });
 * api.canonical("/about/"); // "https://blog.dev/about/"
 * ```
 */
export function createSiteApi(ctx: SiteContext): Api {
  const { config } = ctx;
  return {
    /**
     * Returns the configured site name.
     *
     * @returns The human-readable site name from `config.name`.
     * @example
     * ```ts
     * api.name(); // "My Blog"
     * ```
     */
    name(): string {
      return config.name;
    },
    /**
     * Returns the configured absolute base URL of the site.
     *
     * @returns The base URL from `config.url`.
     * @example
     * ```ts
     * api.url(); // "https://blog.dev"
     * ```
     */
    url(): string {
      return config.url;
    },
    /**
     * Returns the configured site author/byline.
     *
     * @returns The author from `config.author`.
     * @example
     * ```ts
     * api.author(); // "Alex"
     * ```
     */
    author(): string {
      return config.author;
    },
    /**
     * Returns the configured site description.
     *
     * @returns The description from `config.description`.
     * @example
     * ```ts
     * api.description(); // "A personal blog about web frameworks."
     * ```
     */
    description(): string {
      return config.description;
    },
    /**
     * Joins a path against the configured base `url` to produce an absolute
     * canonical URL. An empty path (or "/") returns the base URL unchanged.
     *
     * @param path - Relative path for the page, e.g. "/about/".
     * @returns The absolute canonical URL.
     * @example
     * ```ts
     * api.canonical("/about/"); // "https://blog.dev/about/"
     * ```
     */
    canonical(path: string): string {
      return joinCanonical(config.url, path);
    }
  };
}
