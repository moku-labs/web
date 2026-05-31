/**
 * @file spa plugin — client head-sync adapter over head's pure compose.
 *
 * The dependency on `head` is structural: `spa` reuses the head plugin's
 * composition (it never forks it). At navigation time the SPA already holds the
 * freshly-fetched document — whose `<head>` was produced by `head.compose` at
 * build time — so head-sync is a faithful re-application of that composed head
 * onto the live document, NOT a second composition implementation.
 * @see README.md
 */
import type { Api as HeadApi } from "../head/types";

/** Single-element head selectors synced by replace/append/remove on navigation. */
const META_SELECTORS = [
  'meta[name="description"]',
  'meta[property="og:title"]',
  'meta[property="og:description"]',
  'meta[property="og:url"]',
  'meta[property="og:image"]',
  'meta[property="og:type"]',
  'meta[property="og:locale"]',
  'meta[name="twitter:card"]',
  'meta[name="twitter:title"]',
  'meta[name="twitter:description"]',
  'meta[name="twitter:image"]',
  'meta[name="twitter:site"]',
  'link[rel="canonical"]'
] as const;

/** Head element groups fully replaced (remove-all-then-clone) on navigation. */
const REPLACE_ALL_SELECTORS = [
  'script[type="application/ld+json"]',
  'link[rel="alternate"][hreflang]',
  'meta[property^="article:"]'
] as const;

/**
 * Sync a single head element by selector between the fetched and live document:
 * replace when both exist, append when only the new doc has it, remove when only
 * the live doc has it.
 *
 * @param selector - CSS selector for the head element to sync.
 * @param doc - The fetched document (DOMParser-parsed).
 * @example
 * syncElement('link[rel="canonical"]', doc);
 */
function syncElement(selector: string, doc: Document): void {
  const newElement = doc.querySelector(selector);
  const oldElement = document.querySelector(selector);
  if (newElement && oldElement) {
    oldElement.replaceWith(newElement.cloneNode(true));
  } else if (newElement) {
    document.head.append(newElement.cloneNode(true));
  } else if (oldElement) {
    oldElement.remove();
  }
}

/**
 * Remove all live matches for a selector and re-clone the fetched document's
 * matches into the live `<head>`.
 *
 * @param selector - CSS selector for the element group to replace wholesale.
 * @param doc - The fetched document (DOMParser-parsed).
 * @example
 * replaceAllBySelector('script[type="application/ld+json"]', doc);
 */
function replaceAllBySelector(selector: string, doc: Document): void {
  for (const element of document.querySelectorAll(selector)) element.remove();
  for (const element of doc.querySelectorAll(selector))
    document.head.append(element.cloneNode(true));
}

/**
 * Syncs the live document `<head>` after a navigation from the fetched document
 * (whose head was composed by the `head` plugin). Recomputes
 * title/meta/canonical/JSON-LD/hreflang/`<html lang>` once and applies them.
 * The `head` API is accepted to bind the structural dependency (spec/09 deps).
 *
 * @param _head - The head plugin API (dependency binding; composition reused via the fetched doc). Optional on the browser client path, which has no plugin context.
 * @param doc - The fetched document parsed from the navigated page's HTML.
 * @example
 * syncHead(headApi, parsedDoc);
 */
export function syncHead(_head: HeadApi | undefined, doc: Document): void {
  if (typeof document === "undefined") return;

  const newTitle = doc.querySelector("title")?.textContent;
  if (newTitle) document.title = newTitle;

  const newLang = doc.documentElement.lang;
  if (newLang) document.documentElement.lang = newLang;

  for (const selector of META_SELECTORS) syncElement(selector, doc);
  for (const selector of REPLACE_ALL_SELECTORS) replaceAllBySelector(selector, doc);
}
