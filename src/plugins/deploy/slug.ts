/**
 * @file deploy plugin — Cloudflare project-name slug derivation.
 */

/** Maximum length of a Cloudflare Pages project name. */
const MAX_SLUG_LENGTH = 58;

/** Fallback slug when the input reduces to an empty string. */
const FALLBACK_SLUG = "site";

/**
 * Whether `char` is an ASCII lowercase letter or digit — the only characters kept
 * verbatim in a Cloudflare project-name slug (everything else is a separator).
 *
 * @param char - A single character (already NFKD-normalized and lowercased).
 * @returns `true` for `a–z` or `0–9`, else `false`.
 * @example
 * isAsciiLetterOrDigit("a"); // true
 */
function isAsciiLetterOrDigit(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "0" && char <= "9");
}

/**
 * Convert a site display name into a Cloudflare Pages project-name slug.
 * Normalizes via NFKD and strips diacritics, lowercases, collapses every run of
 * non-alphanumerics into a single hyphen, drops leading/trailing hyphens so the
 * result starts with `[a-z0-9]`, and caps the length to the Cloudflare
 * project-name limit (≤ 58 chars, matching `/^[a-z0-9][a-z0-9-]*$/`). Falls back
 * to `"site"` for all-symbol/empty input. The scan is a single linear pass — no
 * backtracking regex.
 *
 * @param name - The site display name (from `site.name()`).
 * @returns A Cloudflare-valid project-name slug.
 * @example
 * toSlug("My Cool Site!"); // "my-cool-site"
 * @example
 * toSlug("123 Açaí"); // "123-acai"
 */
export function toSlug(name: string): string {
  const normalized = name
    .normalize("NFKD")
    // Strip combining diacritical marks left behind by NFKD.
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLowerCase();

  // Collapse runs of non-alphanumerics into a single hyphen (linear scan, no
  // backtracking). A hyphen is only emitted between two alphanumeric runs, so the
  // result never has leading/trailing or doubled hyphens.
  let slug = "";
  let pendingHyphen = false;
  for (const char of normalized) {
    if (!isAsciiLetterOrDigit(char)) {
      pendingHyphen = true;
      continue;
    }

    // Emit one hyphen for the run of separators we just skipped (never leading).
    if (pendingHyphen && slug.length > 0) slug += "-";
    pendingHyphen = false;
    slug += char;
  }

  // Cap length, then trim any trailing hyphen the cap may have exposed (linear
  // scan — no backtracking regex).
  slug = slug.slice(0, MAX_SLUG_LENGTH);
  let end = slug.length;
  while (end > 0 && slug[end - 1] === "-") end -= 1;
  slug = slug.slice(0, end);
  return slug.length > 0 ? slug : FALLBACK_SLUG;
}
