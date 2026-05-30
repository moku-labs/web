/**
 * @file deploy plugin — Cloudflare project-name slug derivation.
 */

/**
 * Convert a site display name into a Cloudflare Pages project-name slug.
 * Lowercases, replaces non-alphanumerics with hyphens, trims leading/trailing
 * hyphens, and caps length to the Cloudflare project-name limit (<= 58 chars,
 * matching /^[a-z0-9][a-z0-9-]*$/).
 *
 * @param _name - The site display name (from site.name()).
 * @throws {Error} Always — skeleton stub, implemented during build.
 * @example
 * toSlug("My Cool Site!"); // "my-cool-site"
 */
export function toSlug(_name: string): string {
  throw new Error("not implemented");
}
