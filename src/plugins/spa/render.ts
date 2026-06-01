/**
 * @file spa plugin — the client render layer (lazy-loaded split chunk).
 *
 * This is the ONLY spa module that imports Preact's DOM `render`. It is reached
 * exclusively through a lazy `await import("./render")` inside the kernel's
 * data-navigation path, so an app that does NOT compose the `data` plugin (pure
 * HTML-over-fetch navigation) never pulls Preact `render` into its main bundle —
 * the bundle-assertion gate. The bundler splits this file into its own chunk that
 * is fetched only when a route's client DATA render actually runs.
 *
 * The route owns the VNode: `spa` calls the matched route's own `.render(ctx)` to
 * produce the `VNode` (the SAME component the build used for SSG) and this module
 * just commits it to the DOM — so SSR/client parity is structural.
 */

import type { VNode } from "preact";
import { render } from "preact";

/**
 * Render a route's `VNode` into the live swap region, replacing its contents.
 * Reuses the build's component output verbatim (same `route.render`), so the
 * client paint matches the SSG paint.
 *
 * @param vnode - The VNode produced by the matched route's `.render(ctx)`.
 * @param region - The swap-region element to render into.
 * @example
 * ```ts
 * const { renderVNode } = await import("./render");
 * renderVNode(route._handlers.render(ctx), document.querySelector("main > section"));
 * ```
 */
export function renderVNode(vnode: VNode, region: Element): void {
  render(vnode, region);
}
