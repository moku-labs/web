/**
 * @file spa plugin — navigation interception (Navigation API + History fallback).
 * @see README.md
 */

/** Teardown handle returned by the router attach step. */
export type RouterTeardown = () => void;

/**
 * A navigation strategy: perform a navigation to `pathname`, resolving once the
 * swap (or fallback) is dispatched. The kernel injects a DATA-aware navigate
 * (match → data.at(path) → route.render — no `load` on the client) that falls
 * back to the default HTML-over-fetch ({@link performNavigation}); without
 * injection the default is used.
 */
export type NavigateFunction = (pathname: string) => Promise<void>;

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
 * @param pathname - The destination pathname.
 * @param handlers - The navigation lifecycle callbacks.
 * @returns A promise that resolves once the swap (or fallback) is dispatched.
 * @example
 * await performNavigation("/about", handlers);
 */
export async function performNavigation(pathname: string, handlers: RouterHandlers): Promise<void> {
  handlers.onStart(pathname);
  try {
    const response = await fetch(pathname);
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    handlers.onEnd(await response.text(), pathname);
  } catch {
    handlers.onError();
    location.href = pathname;
  }
}

/**
 * Run a DOM-mutating swap, optionally wrapped in the View Transitions API when
 * enabled and supported (instant swap otherwise — never throws).
 *
 * @param doSwap - The synchronous DOM mutation to perform.
 * @param viewTransitions - Whether to wrap the swap in `startViewTransition`.
 * @example
 * runSwap(() => current.replaceWith(next), true);
 */
export function runSwap(doSwap: () => void, viewTransitions: boolean): void {
  const reduced =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const docWithVt = document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  };
  if (viewTransitions && !reduced && typeof docWithVt.startViewTransition === "function") {
    docWithVt.startViewTransition(doSwap);
  } else {
    doSwap();
  }
}

/**
 * Replace the `swapSelector` region of the live document with the matching
 * region of `doc`, wrapped per `viewTransitions`. The `onSwapped` callback runs
 * inside the same transition frame (after the DOM mutation) so component
 * re-mounting is captured by the transition snapshot.
 *
 * @param doc - The fetched document (DOMParser-parsed) holding the new region.
 * @param swapSelector - CSS selector for the region to replace.
 * @param viewTransitions - Whether to wrap the swap in `startViewTransition`.
 * @param onSwapped - Callback run after the DOM mutation (mount/notify/scroll).
 * @example
 * swapRegion(doc, "main > section", false, () => mountNew());
 */
export function swapRegion(
  doc: Document,
  swapSelector: string,
  viewTransitions: boolean,
  onSwapped: () => void
): void {
  const newContent = doc.querySelector(swapSelector);
  const currentContent = document.querySelector(swapSelector);
  if (!newContent || !currentContent) return;
  runSwap(() => {
    currentContent.replaceWith(newContent);
    onSwapped();
  }, viewTransitions);
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
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return undefined;
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
  navigate: NavigateFunction = pathname => performNavigation(pathname, handlers)
): RouterTeardown {
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
    event.preventDefault();
    if (url.pathname === location.pathname) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    saveScrollPosition(location.pathname);
    history.pushState({ scrollY: 0 }, "", url.pathname);
    navigate(url.pathname)
      .then(() => window.scrollTo(0, 0))
      .catch(() => {});
  };
  /**
   * Re-run navigation on back/forward, restoring the saved scroll position.
   *
   * @example
   * globalThis.addEventListener("popstate", onPopState);
   */
  const onPopState = (): void => {
    navigate(location.pathname)
      .then(() => restoreScrollPosition(location.pathname))
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
  navigate: NavigateFunction = pathname => performNavigation(pathname, handlers)
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
    if (!navEvent.canIntercept || navEvent.hashChange || navEvent.downloadRequest) return;
    if (!isInternalLink(url)) return;
    if (url.pathname === location.pathname) {
      navEvent.intercept({
        // eslint-disable-next-line jsdoc/require-jsdoc -- inline same-page scroll handler
        handler: () => {
          window.scrollTo({ top: 0, behavior: "smooth" });
          return Promise.resolve();
        }
      });
      return;
    }
    navEvent.intercept({
      scroll: "manual",
      // eslint-disable-next-line jsdoc/require-jsdoc -- inline fetch-and-swap handler
      handler: async () => {
        await navigate(url.pathname);
        if (navEvent.navigationType === "traverse") {
          navEvent.scroll();
        } else {
          window.scrollTo(0, 0);
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
