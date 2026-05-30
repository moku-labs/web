/**
 * @file site plugin — config validation + API factory and canonical-URL helpers.
 */
import type { Api } from "./types";

/**
 * Joins a relative path against an absolute base URL, normalizing the slash
 * boundary to exactly one "/". Returns the base unchanged for an empty or
 * root ("/") path.
 *
 * @param _base - Absolute base URL from config (may have trailing slash).
 * @param _path - Relative path to join (may have leading slash).
 * @example
 * ```ts
 * joinCanonical("https://blog.dev/", "/about/"); // "https://blog.dev/about/"
 * ```
 */
export function joinCanonical(_base: string, _path: string): string {
  throw new Error("not implemented");
}

/**
 * Validates that a string is a non-empty trimmed value.
 *
 * @param _value - The value to test.
 * @example
 * ```ts
 * isNonEmpty("  "); // false
 * ```
 */
export function isNonEmpty(_value: string): boolean {
  throw new Error("not implemented");
}

/**
 * Validates that a string is a parseable absolute http/https URL.
 *
 * @param _value - The candidate URL string.
 * @example
 * ```ts
 * isAbsoluteUrl("https://blog.dev"); // true
 * ```
 */
export function isAbsoluteUrl(_value: string): boolean {
  throw new Error("not implemented");
}

/**
 * Validates the resolved config (fail-fast at `createApp`, synchronous). Throws
 * if `config.name` is empty/whitespace-only, or if `config.url` is not a valid
 * absolute http/https URL. Errors use the `[web]` prefix.
 *
 * @param _ctx - Plugin context (`{ config }`); unused in skeleton.
 * @example
 * ```ts
 * validateSiteConfig(ctx);
 * ```
 */
export function validateSiteConfig(_ctx: unknown): void {
  throw new Error("not implemented");
}

/**
 * Creates the site plugin API surface — read-only accessors over frozen config
 * plus the `canonical` helper.
 *
 * @param _ctx - Plugin context (`{ config }`); unused in skeleton.
 * @example
 * ```ts
 * const api = createSiteApi(ctx);
 * ```
 */
export function createSiteApi(_ctx: unknown): Api {
  throw new Error("not implemented");
}
