/**
 * @file spa plugin — navigation interception (Navigation API + History fallback).
 * @see README.md
 */

import type { ScrollMode } from "../router/types";

/** Teardown handle returned by the router attach step. */
export type RouterTeardown = () => void;

/**
 * The resolved View-Transition descriptor for one swap. `enabled` gates whether a
 * View Transition wraps the swap at all; `types` carries the named transition(s)
 * (e.g. `["slide"]`) — empty for the default root crossfade.
 */
export interface SwapTransition {
  /** Whether to wrap the swap in a View Transition (false ⇒ instant swap). */
  enabled: boolean;
  /** Named transition types for this swap (empty ⇒ default root crossfade). */
  types: string[];
}

/**
 * A navigation strategy: perform a navigation to `pathname`, resolving once the
 * swap (or fallback) is dispatched. The kernel injects a DATA-aware navigate
 * (match → data.at(path) → route.render — no `load` on the client) that falls
 * back to the default HTML-over-fetch ({@link performNavigation}); without
 * injection the default is used.
 *
 * `scrollToTop` (default `true`) is applied as part of the swap (just before the
 * View Transition snapshot), NOT by the router after navigating — so the old/new
 * snapshots share the same scrollY and a sticky header never un-pins. Traverse
 * (back/forward) passes `false` to keep its restored scroll position.
 *
 * `signal` (the Navigation API's `navEvent.signal`) aborts when this navigation
 * is superseded or canceled. Implementations MUST NOT apply their swap once it
 * has aborted: on a rapid back→forward the URL commits synchronously per
 * navigation but the fetch-and-swap is async, so without the signal two fetches
 * race last-write-wins and a stale swap can land after the live navigation
 * committed (URL showing one page, body showing another).
 */
export type NavigateFunction = (
  pathname: string,
  scrollToTop?: boolean,
  signal?: AbortSignal,
  scrollOverride?: ScrollMode
) => Promise<void>;

/**
 * Minimal Navigation API surface used by the router. The Navigation API is not
 * yet in TypeScript's DOM lib, so the slice the router consumes is declared here.
 */
interface NavigateEvent extends Event {
  /** Whether the navigation can be intercepted. */
  readonly canIntercept: boolean;
  /** The navigation destination (absolute URL). */
  readonly destination: { readonly url: string };
  /** A download filename when this is a download request, else `null` (DOM API shape). */
  readonly downloadRequest: string | null;
  /** Whether this navigation is only a hash change. */
  readonly hashChange: boolean;
  /** The navigation type. */
  readonly navigationType: "push" | "replace" | "reload" | "traverse";
  /** Aborts when this navigation is superseded by a newer one (or canceled). */
  readonly signal: AbortSignal;
  /**
   * Intercept the navigation with a custom handler.
   *
   * @param options - The intercept options.
   * @param options.handler - The async navigation handler (fetch + swap).
   * @param options.scroll - Scroll-restoration behaviour for this navigation.
   */
  intercept(options: {
    handler: () => Promise<void>;
    scroll?: "after-transition" | "manual";
  }): void;
  /** Trigger deferred scroll restoration (manual scroll mode). */
  scroll(): void;
}

/** The `window.navigation` Navigation API object (the slice the router uses). */
interface NavigationApi {
  /**
   * Subscribe to `navigate` events.
   *
   * @param type - The event type (always `"navigate"`).
   * @param listener - The navigate-event listener.
   */
  addEventListener(type: "navigate", listener: (event: NavigateEvent) => void): void;
  /**
   * Unsubscribe a previously-added `navigate` listener.
   *
   * @param type - The event type (always `"navigate"`).
   * @param listener - The navigate-event listener to remove.
   */
  removeEventListener(type: "navigate", listener: (event: NavigateEvent) => void): void;
}

/**
 * Read the Navigation API global, or `undefined` when unsupported.
 *
 * @returns The `navigation` object, or `undefined` in unsupporting environments.
 * @example
 * const nav = getNavigation();
 */
function getNavigation(): NavigationApi | undefined {
  return (globalThis as typeof globalThis & { navigation?: NavigationApi }).navigation;
}

/** Navigation lifecycle callbacks the kernel supplies to the router. */
export interface RouterHandlers {
  /**
   * A navigation to `pathname` has begun (intercepted, before fetch).
   *
   * @param pathname - The destination pathname.
   * @example
   * handlers.onStart("/about");
   */
  onStart(pathname: string): void;
  /**
   * The page HTML arrived; swap + head-sync + component lifecycle should run.
   *
   * @param html - The fetched page HTML.
   * @param pathname - The destination pathname.
   * @example
   * handlers.onEnd("<html>…</html>", "/about");
   */
  onEnd(html: string, pathname: string): void;
  /**
   * The fetch failed; the caller has already fallen back to a full navigation.
   *
   * @example
   * handlers.onError();
   */
  onError(): void;
}

/** File extensions that bypass the SPA router (treated as static assets). */
const STATIC_ASSET_RE = /\.(xml|json|png|jpe?g|pdf|ico|svg|webp|woff2?)$/i;

/**
 * Whether a URL is an internal page link (same origin, not a static asset).
 *
 * @param url - The URL to classify.
 * @returns True when same-origin and not a static asset.
 * @example
 * isInternalLink(new URL("https://x.dev/about", location.origin));
 */
export function isInternalLink(url: URL): boolean {
  return url.origin === location.origin && !STATIC_ASSET_RE.test(url.pathname);
}

/**
 * The navigable path of a URL or Location: pathname plus query string. The query
 * is part of page identity (the kernel's `currentUrl` is pathname + search), so
 * same-page checks, history entries, fetches, and scroll keys must all carry it —
 * comparing pathnames alone would treat `/search?q=a` → `/search?q=b` as same-page
 * and the History fallback would drop the query from the address bar.
 *
 * @param target - The URL or Location to read.
 * @param target.pathname - The path component.
 * @param target.search - The query-string component (`""` when absent).
 * @returns The pathname + search string.
 * @example
 * pathWithSearch(new URL("https://x.dev/search?q=a")); // "/search?q=a"
 */
function pathWithSearch(target: { pathname: string; search: string }): string {
  return target.pathname + target.search;
}

/**
 * Save the current scroll position keyed by path (best-effort; ignores storage errors).
 *
 * @param path - The path to key the scroll position under.
 * @example
 * saveScrollPosition("/about");
 */
export function saveScrollPosition(path: string): void {
  try {
    sessionStorage.setItem(`spa:scroll:${path}`, String(window.scrollY));
  } catch {
    // sessionStorage unavailable (private mode / quota) — ignore.
  }
}

/**
 * Restore a previously-saved scroll position for `path`, if any.
 *
 * @param path - The path whose saved scroll position to restore.
 * @example
 * restoreScrollPosition("/about");
 */
export function restoreScrollPosition(path: string): void {
  try {
    const saved = sessionStorage.getItem(`spa:scroll:${path}`);
    if (saved) window.scrollTo(0, Number(saved));
  } catch {
    // Ignore storage errors.
  }
}

/**
 * Fetch a page and hand its HTML to the handlers; on any error fall back to a
 * full browser navigation (`location.href = pathname`).
 *
 * When `signal` aborts (this navigation was superseded by a newer one) the
 * fetch is cancelled and NOTHING is applied: no swap (onEnd) and no fallback
 * reload — the live navigation owns the document from that point on.
 *
 * @param pathname - The destination pathname.
 * @param handlers - The navigation lifecycle callbacks.
 * @param signal - Aborts when this navigation is superseded (`navEvent.signal`).
 * @returns A promise that resolves once the swap (or fallback) is dispatched.
 * @example
 * await performNavigation("/about", handlers, navEvent.signal);
 */
export async function performNavigation(
  pathname: string,
  handlers: RouterHandlers,
  signal?: AbortSignal
): Promise<void> {
  handlers.onStart(pathname);
  try {
    const response = await (signal ? fetch(pathname, { signal }) : fetch(pathname));
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    const html = await response.text();
    // A superseded navigation must never apply its swap: bail before onEnd
    // (swap + head-sync + island teardown) once the browser aborted this nav.
    if (signal?.aborted) return;
    handlers.onEnd(html, pathname);
  } catch {
    // Aborted = superseded, not failed: vanish quietly. The href fallback would
    // force a full reload of the STALE destination over the live navigation.
    if (signal?.aborted) return;
    handlers.onError();
    location.href = pathname;
  }
}

/**
 * Whether the user has asked the platform to minimise motion.
 *
 * @returns `true` when `(prefers-reduced-motion: reduce)` currently matches; `false` when
 *   it does not, or when `matchMedia` is absent (guards SSR/test environments).
 * @example
 * const behavior: ScrollBehavior = prefersReducedMotion() ? "instant" : "smooth";
 */
function prefersReducedMotion(): boolean {
  return (
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Run a DOM-mutating swap, optionally wrapped in the View Transitions API when
 * enabled and supported (instant swap otherwise — never throws).
 *
 * `beforeCapture` runs synchronously immediately before the swap — for the View
 * Transitions path that is before `startViewTransition` captures the "old" snapshot.
 * Scroll restoration belongs HERE, not in the router after the navigation: setting
 * the destination scroll at this moment means the old and new snapshots share the
 * same scrollY, so there is no scroll delta for the transition to animate and a
 * `position: sticky` header never un-pins (the cross-engine flicker, worst on WebKit).
 * Because the swap is post-fetch, doing it here also avoids the visible "scroll up,
 * THEN the page loads" pause that scrolling in the router (pre-fetch) produced.
 *
 * Named transitions (`transition.types`, e.g. `["slide"]`) are exposed to CSS two ways
 * for the transition's lifetime, so a consumer can style the motion per navigation:
 *   • a `:root[data-view-transition~="slide"]` attribute (works on EVERY View-Transitions
 *     engine, including those without the `types` dictionary form);
 *   • the standards-track `types` option (`:active-view-transition-type(slide)`) when the
 *     engine supports the `startViewTransition({ update, types })` dictionary form.
 * Empty `types` ⇒ the default root crossfade. A shared `view-transition-name` left on an
 * element across the swap (e.g. a card and the panel it opens) morphs one into the other.
 *
 * @param doSwap - The synchronous DOM mutation to perform.
 * @param transition - The resolved {@link SwapTransition} (enabled + named types).
 * @param beforeCapture - Optional hook run synchronously just before the swap/capture
 *   (e.g. scroll to the destination position).
 * @example
 * runSwap(() => current.replaceWith(next), { enabled: true, types: ["slide"] });
 */
export function runSwap(
  doSwap: () => void,
  transition: SwapTransition,
  beforeCapture?: () => void
): void {
  const reduced = prefersReducedMotion();
  const docWithVt = document as Document & {
    startViewTransition?: (
      cb: (() => void) | { update: () => void; types?: string[] }
    ) => { finished?: Promise<unknown>; ready?: Promise<unknown> } | undefined;
  };
  const canUseViewTransitions =
    transition.enabled && !reduced && typeof docWithVt.startViewTransition === "function";
  // Set the destination scroll BEFORE the "old" snapshot is captured (see above): no
  // scroll delta to animate → the sticky header holds, and no pre-fetch scroll pause.
  beforeCapture?.();
  if (!canUseViewTransitions) {
    doSwap();
    return;
  }

  const root = typeof document === "undefined" ? undefined : document.documentElement;
  const hasTypes = transition.types.length > 0;
  // Expose the named transition to CSS for the swap's duration (cleared once it settles).
  if (hasTypes && root) root.dataset.viewTransition = transition.types.join(" ");
  // eslint-disable-next-line jsdoc/require-jsdoc -- inline marker cleanup once the transition settles
  const clearMarker = (): void => {
    if (hasTypes && root) delete root.dataset.viewTransition;
  };

  let result: { finished?: Promise<unknown>; ready?: Promise<unknown> } | undefined;
  if (hasTypes) {
    try {
      // Standards-track dictionary form: also drives `:active-view-transition-type(...)`.
      result = docWithVt.startViewTransition({ update: doSwap, types: transition.types });
    } catch {
      // Older engine without the dictionary form — the data-attribute marker still drives CSS.
      result = docWithVt.startViewTransition(doSwap);
    }
  } else {
    result = docWithVt.startViewTransition(doSwap);
  }
  // Clear the marker once the transition settles (both fulfil + reject paths); the `.catch`
  // keeps the promise non-floating without a `void` operator.
  Promise.resolve(result?.finished).then(clearMarker).catch(clearMarker);
  // A transition superseded BEFORE it paints (rapid / overlapping navigation) rejects `ready` with
  // `AbortError: "Transition was skipped"` — even though `finished` still resolves and the swap still
  // applies. The skip is benign, so own that one rejection HERE rather than leaking an "Uncaught (in
  // promise)" to every consumer's console. (Nothing else reads `ready`; this purely marks it handled.)
  Promise.resolve(result?.ready).catch(() => {});
}

/**
 * Replace the `swapSelector` region of the live document with the matching
 * region of `doc`, wrapped per `viewTransitions`. The `onSwapped` callback runs
 * inside the same transition frame (after the DOM mutation) so component
 * re-mounting is captured by the transition snapshot.
 *
 * Returns whether the swap was dispatched: `false` when either document lacks
 * the `swapSelector` region, so the caller can fall back to a full navigation
 * instead of finishing the SPA nav against an un-swapped body.
 *
 * @param doc - The fetched document (DOMParser-parsed) holding the new region.
 * @param swapSelector - CSS selector for the region to replace.
 * @param transition - The resolved {@link SwapTransition} (enabled + named types).
 * @param onSwapped - Callback run after the DOM mutation (mount/notify/scroll).
 * @param beforeCapture - Optional hook run synchronously just before the swap/capture
 *   (forwarded to {@link runSwap} — e.g. scroll to the destination position).
 * @returns `true` when the swap was dispatched, `false` when either document lacks the region.
 * @example
 * swapRegion(doc, "main > section", { enabled: false, types: [] }, () => mountNew());
 */
export function swapRegion(
  doc: Document,
  swapSelector: string,
  transition: SwapTransition,
  onSwapped: () => void,
  beforeCapture?: () => void
): boolean {
  const newContent = doc.querySelector(swapSelector);
  const currentContent = document.querySelector(swapSelector);
  if (!newContent || !currentContent) return false;
  runSwap(
    () => {
      currentContent.replaceWith(newContent);
      onSwapped();
    },
    transition,
    beforeCapture
  );
  return true;
}

/**
 * Resolve a navigable internal URL from a click event, or `undefined` when the
 * click should not be intercepted (modifier keys, non-anchor, external, new-tab).
 *
 * @param event - The click event to inspect.
 * @returns The internal URL to navigate to, or `undefined`.
 * @example
 * const url = resolveClickTarget(event);
 */
export function resolveClickTarget(event: MouseEvent): URL | undefined {
  const hasModifierKey = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  if (hasModifierKey) return undefined;
  if (event.defaultPrevented) return undefined;
  const anchor = (event.target as Element | null)?.closest("a");
  if (!anchor || anchor.target === "_blank") return undefined;
  let url: URL;
  try {
    url = new URL(anchor.href, location.origin);
  } catch {
    return undefined;
  }
  return isInternalLink(url) ? url : undefined;
}

/**
 * Attach the History-API click/popstate interception path (used when the
 * Navigation API is unavailable).
 *
 * @param handlers - The navigation lifecycle callbacks.
 * @param navigate - The navigation strategy (defaults to HTML-over-fetch via `performNavigation`).
 * @returns A teardown that removes the attached listeners.
 * @example
 * const dispose = attachHistoryFallback(handlers);
 */
export function attachHistoryFallback(
  handlers: RouterHandlers,
  navigate: NavigateFunction = (pathname, _scrollToTop, signal) =>
    performNavigation(pathname, handlers, signal)
): RouterTeardown {
  // One in-flight navigation at a time. The History API has no navEvent.signal, so the
  // router mints its own: each new click/popstate aborts the previous fetch-and-swap,
  // closing the same last-write-wins race the Navigation API path closes — without this,
  // a stale fetch resolving late would swap its body over the live navigation's URL.
  let controller: AbortController | undefined;
  /**
   * Supersede the in-flight navigation (if any) and mint the next one's abort signal.
   *
   * @returns The fresh navigation's abort signal.
   * @example
   * const signal = supersede();
   */
  const supersede = (): AbortSignal => {
    controller?.abort();
    controller = new AbortController();
    return controller.signal;
  };
  /**
   * Intercept an internal-link click and run a History-API navigation.
   *
   * @param event - The click event.
   * @example
   * document.addEventListener("click", onClick);
   */
  const onClick = (event: MouseEvent): void => {
    const url = resolveClickTarget(event);
    if (!url) return;
    // Same-page fragment link (<a href="#section">): bail WITHOUT preventDefault so the
    // browser performs the native anchor jump and updates the hash. This mirrors the
    // Navigation API path, which skips hash-only navigations via `navEvent.hashChange`.
    if (url.pathname === location.pathname && url.hash) return;
    event.preventDefault();
    if (pathWithSearch(url) === pathWithSearch(location)) {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "instant" : "smooth" });
      return;
    }
    saveScrollPosition(pathWithSearch(location));
    history.pushState({ scrollY: 0 }, "", pathWithSearch(url));
    // Forward nav scrolls to top as PART of the swap (runSwap's `beforeCapture`), not
    // here: that fires just before the View Transition snapshot (so scrollY=0 at capture
    // → no delta → the sticky header holds) AND after the fetch (so there is no "scroll
    // up, then the page loads" pause). The router just hands off the navigation.
    navigate(pathWithSearch(url), true, supersede()).catch(() => {});
  };
  /**
   * Re-run navigation on back/forward, restoring the saved scroll position.
   *
   * @example
   * globalThis.addEventListener("popstate", onPopState);
   */
  const onPopState = (): void => {
    // Traverse: keep the saved scroll. `scrollToTop: false` stops the swap resetting to
    // top, then we restore the saved position once the swap has dispatched.
    const path = pathWithSearch(location);
    const signal = supersede();
    navigate(path, false, signal)
      .then(() => {
        // A superseded traverse must not poke scroll restoration on a dead navigation.
        if (!signal.aborted) restoreScrollPosition(path);
      })
      .catch(() => {});
  };
  document.addEventListener("click", onClick);
  globalThis.addEventListener("popstate", onPopState);
  return () => {
    document.removeEventListener("click", onClick);
    globalThis.removeEventListener("popstate", onPopState);
  };
}

/**
 * Attach the Navigation-API interception path (the primary path when supported).
 *
 * @param navigation - The Navigation API object to attach the listener to.
 * @param handlers - The navigation lifecycle callbacks.
 * @param navigate - The navigation strategy (defaults to HTML-over-fetch via `performNavigation`).
 * @returns A teardown that removes the `navigate` listener.
 * @example
 * const dispose = attachNavigationApi(navigation, handlers);
 */
export function attachNavigationApi(
  navigation: NavigationApi,
  handlers: RouterHandlers,
  navigate: NavigateFunction = (pathname, _scrollToTop, signal) =>
    performNavigation(pathname, handlers, signal)
): RouterTeardown {
  /**
   * Handle a `navigate` event: classify, then intercept with fetch-and-swap.
   *
   * @param navEvent - The Navigation API navigate event.
   * @example
   * navigation.addEventListener("navigate", onNavigate);
   */
  const onNavigate = (navEvent: NavigateEvent): void => {
    const url = new URL(navEvent.destination.url);
    const shouldSkipIntercept =
      !navEvent.canIntercept || navEvent.hashChange || navEvent.downloadRequest;
    if (shouldSkipIntercept) return;
    if (!isInternalLink(url)) return;
    if (pathWithSearch(url) === pathWithSearch(location)) {
      navEvent.intercept({
        // eslint-disable-next-line jsdoc/require-jsdoc -- inline same-page scroll handler
        handler: () => {
          window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "instant" : "smooth" });
          return Promise.resolve();
        }
      });
      return;
    }
    navEvent.intercept({
      scroll: "manual",
      // eslint-disable-next-line jsdoc/require-jsdoc -- inline fetch-and-swap handler
      handler: async () => {
        // Traverse (back/forward) keeps its saved scroll: `scrollToTop: false` so the swap
        // does not reset to top, then the browser restores the position after the swap.
        // Forward nav (push/replace) scrolls to top as PART of the swap (runSwap's
        // `beforeCapture`) — captured at scrollY=0 (no delta → the sticky header holds) and
        // after the fetch (no "scroll up, then load" pause).
        // `navEvent.signal` rides along so a superseded navigation (rapid back→forward)
        // can never apply its swap after the live one committed.
        if (navEvent.navigationType === "traverse") {
          await navigate(pathWithSearch(url), false, navEvent.signal);
          // A superseded traverse must not poke scroll restoration on a dead navigation.
          if (!navEvent.signal.aborted) navEvent.scroll();
        } else {
          await navigate(pathWithSearch(url), true, navEvent.signal);
        }
      }
    });
  };
  navigation.addEventListener("navigate", onNavigate);
  return () => navigation.removeEventListener("navigate", onNavigate);
}

/**
 * Attach navigation interception: Navigation API (primary) with a History API
 * fallback. Returns a teardown removing every listener it attached.
 *
 * @param handlers - The navigation lifecycle callbacks the kernel supplies.
 * @param navigate - The navigation strategy (defaults to HTML-over-fetch via `performNavigation`).
 * @returns A teardown removing all attached listeners.
 * @example
 * const dispose = attachRouter(handlers, navigate);
 */
export function attachRouter(
  handlers: RouterHandlers,
  navigate?: NavigateFunction
): RouterTeardown {
  const navigation = getNavigation();
  return navigation
    ? attachNavigationApi(navigation, handlers, navigate)
    : attachHistoryFallback(handlers, navigate);
}
