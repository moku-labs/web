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
 * Render a route's `VNode` into the live swap region, starting from a clean slate
 * each time. Preact keeps the previous vdom tree on the container and diffs the
 * next render against it — but the kernel clears the region between navs to drop
 * the static SSR markup. A raw `replaceChildren()` would delete the live DOM out
 * from under Preact's retained vdom, so the next diff patches detached nodes → an
 * empty region (the bug where a SECOND consecutive client nav went blank).
 *
 * To stay correct without tracking element identity, first `render(null, region)`
 * — this unmounts any Preact tree Preact owns AND resets its retained vdom pointer
 * (a no-op the first time, when the region still holds raw SSR/HTML). Then clear
 * whatever static children remain, then mount the new VNode fresh. Reuses the
 * build's component output verbatim (same `route.render`), so the client paint
 * matches the SSG paint.
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
  // eslint-disable-next-line unicorn/no-null -- Preact's unmount sentinel (resets the retained vdom)
  render(null, region);
  region.replaceChildren();
  render(vnode, region);
}

/**
 * Commit a component's VNode into its host as a DIFF — the in-interaction render
 * path. Unlike {@link renderVNode} (which RESETS the region: unmount → clear → mount,
 * correct for a navigation swap of static SSR markup), this is a plain Preact
 * `render(vnode, host)` that diffs against Preact's retained vdom, preserving focus,
 * scroll, and uncontrolled input state across re-renders triggered by `ctx.set`.
 *
 * Reached ONLY through the lazy `await import("./render")` gate (the component render
 * scheduler in `components.ts`), so an app whose islands never return a VNode never
 * pulls Preact's `render` into its main bundle.
 *
 * @param vnode - The VNode produced by a component's `render(state, ctx)`.
 * @param host - The island's host element to render into.
 * @example
 * ```ts
 * const { commitVNode } = await import("./render");
 * commitVNode(h(BoardView, { snapshot }), host);
 * ```
 */
export function commitVNode(vnode: VNode, host: Element): void {
  render(vnode, host);
}
