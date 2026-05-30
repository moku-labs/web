/**
 * @file build phase 3 — pages. Pulls `router.manifest()` + `head.render(route, data)`
 * and SSR-renders each route to static HTML (preact-render-to-string). Appends the
 * build-id meta tag after `head.render()` returns. Does NOT compose `<head>` itself.
 */

/**
 * Renders every route in the manifest to `outDir/<path>/index.html`. For each route:
 * expands instances via `route.generate?.(locale)`, loads data via `route.load?.()`,
 * pulls the composed `<head>` via `ctx.require(headPlugin).render(route, data)`,
 * renders the body, injects the build-id meta tag, and writes the file. Captures the
 * default page's HTML for the root index. May render concurrently via `Promise.all`.
 *
 * @param _ctx - Plugin context (provides `require`, `state`, `config`, `log`).
 * @returns The number of pages rendered and the captured default-page HTML.
 * @example
 * ```ts
 * const { pageCount, rootHtml } = await renderPages(ctx);
 * ```
 */
export function renderPages(
  _ctx: unknown
): Promise<{ pageCount: number; rootHtml: string | null }> {
  throw new Error("not implemented");
}
