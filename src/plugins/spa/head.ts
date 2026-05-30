/**
 * @file spa plugin — client head-sync adapter over head's pure compose.
 * @see README.md
 */
import type { Api as HeadApi } from "../head/types";

/**
 * Syncs the live document `<head>` after a navigation by reusing the head
 * plugin's pure compose (no forked composition). Recomputes
 * title/meta/canonical/JSON-LD/hreflang/`<html lang>` once and applies them.
 *
 * @param _head - The head plugin API exposing the pure compose.
 * @param _path - The path being navigated to (compose input).
 * @example
 * syncHead(head, "/about");
 */
export function syncHead(_head: HeadApi, _path: string): void {
  throw new Error("not implemented");
}
