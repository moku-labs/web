/**
 * @file spa plugin — opt-in in-memory HTML preload cache (`spa.prefetch`).
 * @see README.md
 */

// Sites serve HTML with `max-age=0, must-revalidate`, so a browser `<link rel=prefetch>` is
// revalidated on the tap and saves nothing. This cache keeps the preloaded HTML in memory and the
// kernel's navigation takes it from here. A pure factory (no ctx, no module singletons): the
// kernel keeps the one live preloader on `state.prefetch` (spec/08 §6) and disposes it on stop.

import { fetchPage, pathWithSearch, resolveLinkTarget } from "./router";

// Fixed numbers, not config (decided in the change spec).
const HOVER_DELAY_MS = 65;
const TTL_MS = 30_000;
const MAX_ENTRIES = 20;
const VISIBLE_CONCURRENCY = 2;
// Queue drain delay where `requestIdleCallback` is missing (Safari).
const IDLE_FALLBACK_MS = 200;
// `effectiveType` of a 2G connection: "2g" and "slow-2g".
const SLOW_CONNECTION = /(^|-)2g$/;
// Passive: a preload listener never delays the tap or the scroll.
const PRESS: AddEventListenerOptions = { capture: true, passive: true };
const HOVER: AddEventListenerOptions = { passive: true };

/** The Network Information API slice read here (not in TypeScript's DOM lib). */
interface ConnectionSlice {
  /** The user turned data saving on. */
  readonly saveData?: boolean;
  /** The measured connection class: `"4g"`, `"3g"`, `"2g"` or `"slow-2g"`. */
  readonly effectiveType?: string;
}

/** One preload in the cache. */
interface PrefetchEntry {
  /** The page HTML; rejects on a network error, a response that is not ok, or an abort. */
  promise: Promise<string>;
  /** `options.now()` when the preload started: the 30 s TTL counts from here. */
  startedAt: number;
  /** The preload's own controller, never a navigation's signal. */
  controller: AbortController;
}

/** What {@link createPrefetcher} needs from the kernel. */
export interface PrefetchOptions {
  /** The preload mode; `false` never reaches here (the kernel builds no preloader). */
  mode: "intent" | "visible";
  /** True when a navigation to this path would fetch HTML (not the DATA path). */
  usesHtml: (path: string) => boolean;
  /** Injected for tests. Defaults to `Date.now`. */
  now?: () => number;
}

/** The live preloader the kernel keeps on `state.prefetch`. */
export interface Prefetcher {
  /**
   * Take the preload for `path` and remove it: one use only. Undefined on a miss or an
   * entry older than 30 s.
   *
   * @param path - The page path (pathname + search).
   * @returns The pending or settled page HTML, or `undefined`.
   * @example
   * // A navigation to /en/about/ right after a pointerdown on its link:
   * state.prefetch?.take("/en/about/"); // Promise<string>; a second take returns undefined
   */
  take(path: string): Promise<string> | undefined;
  /**
   * Re-observe every eligible `a[href]` in the document. `"visible"` only; a no-op for
   * `"intent"`. The kernel calls it at boot and after every swap.
   *
   * @example
   * // After a swap mounted the new page's islands, watch the new page's links:
   * state.prefetch?.observe();
   */
  observe(): void;
  /**
   * Remove the listeners, disconnect the observer, clear timers and idle callbacks, abort
   * in-flight preloads, empty the map. Idempotent.
   *
   * @example
   * // kernel.dispose() on app.stop(): no preload listener stays on document
   * state.prefetch?.dispose();
   * state.prefetch = null;
   */
  dispose(): void;
}

/**
 * Read `navigator.connection` (mirrors `getNavigation()` in `router.ts`).
 *
 * @returns The connection info, or `undefined` where the browser has none.
 * @example
 * getConnection()?.saveData; // true with data saving on
 */
function getConnection(): ConnectionSlice | undefined {
  return (navigator as Navigator & { connection?: ConnectionSlice }).connection;
}

/**
 * Whether no preload may start now: data saving on, or a 2G connection.
 *
 * @returns True when preloads must wait.
 * @example
 * isConstrained(); // true on effectiveType "slow-2g"
 */
function isConstrained(): boolean {
  const connection = getConnection();
  return connection?.saveData === true || SLOW_CONNECTION.test(connection?.effectiveType ?? "");
}

/**
 * The link an event happened on.
 *
 * @param event - A press or mouse event.
 * @returns The closest `<a>`, or nothing.
 * @example
 * anchorOf(event); // <a href="/about"> for a tap on the <span> inside it
 */
function anchorOf(event: Event): HTMLAnchorElement | null | undefined {
  return event.target instanceof Element ? event.target.closest("a") : undefined;
}

/**
 * Run `task` in idle time, or after 200 ms where `requestIdleCallback` is missing.
 *
 * @param task - The work to run.
 * @returns Cancels the task.
 * @example
 * const cancel = whenIdle(drain); // cancel() before idle time: drain never runs
 */
function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(task);
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(task, IDLE_FALLBACK_MS);
  return () => clearTimeout(handle);
}

/**
 * Build the preloader: press and hover listeners on `document` at once, and for
 * `"visible"` one IntersectionObserver that {@link Prefetcher.observe} feeds.
 *
 * @param options - The mode, the HTML-path check and the clock.
 * @returns The live preloader.
 * @example
 * createPrefetcher({ mode: "intent", usesHtml: () => true }).take("/about"); // undefined
 */
export function createPrefetcher(options: PrefetchOptions): Prefetcher {
  const now = options.now ?? Date.now;
  // Insertion order is age order: a key is never re-inserted while it is present.
  const cache = new Map<string, PrefetchEntry>();
  const hoverTimers = new Map<Element, ReturnType<typeof setTimeout>>();
  const queue: string[] = [];
  let visibleInFlight = 0;
  let cancelDrain: (() => void) | undefined;

  /**
   * Whether an entry is older than the TTL.
   *
   * @param entry - A cache entry.
   * @returns True when the entry must not be used.
   * @example
   * isExpired(entry); // true 30_001 ms after it started
   */
  const isExpired = (entry: PrefetchEntry): boolean => now() - entry.startedAt > TTL_MS;

  /**
   * Abort an entry's request and remove it.
   *
   * @param key - The entry's path.
   * @param entry - The entry.
   * @example
   * drop("/a/", entry);
   */
  const drop = (key: string, entry: PrefetchEntry): void => {
    entry.controller.abort();
    cache.delete(key);
  };

  /**
   * The path a link would preload, or `undefined` when it is not eligible.
   *
   * @param anchor - The link, or nothing.
   * @returns The path (pathname + search), or `undefined`.
   * @example
   * pathOf(document.querySelector("a[href='/about?x=1#top']")); // "/about?x=1"
   */
  const pathOf = (anchor: HTMLAnchorElement | null | undefined): string | undefined => {
    // The click interceptor's rule (an <a>, not _blank, same origin, not a static asset), plus:
    // no download link, not the current page, and only a page the HTML path renders.
    const url = resolveLinkTarget(anchor);
    if (!url || anchor?.hasAttribute("download")) return undefined;
    const path = pathWithSearch(url);
    return path !== pathWithSearch(location) && options.usesHtml(path) ? path : undefined;
  };

  /**
   * Start one preload, unless the connection forbids it or the path is already cached.
   *
   * @param path - The page path.
   * @returns The new entry, or `undefined` when nothing started.
   * @example
   * start("/about"); // { promise, startedAt, controller }
   */
  const start = (path: string): PrefetchEntry | undefined => {
    // Checked at every start: the connection can change while the page is open.
    if (isConstrained()) return undefined;
    for (const [key, entry] of cache) {
      if (isExpired(entry)) drop(key, entry);
    }
    if (cache.has(path)) return undefined;
    for (const [key, entry] of cache) {
      if (cache.size < MAX_ENTRIES) break;
      drop(key, entry);
    }
    const controller = new AbortController();
    const promise = fetchPage(path, controller.signal);
    const entry: PrefetchEntry = { promise, startedAt: now(), controller };
    cache.set(path, entry);
    // A failed preload removes only its own entry and never surfaces as an unhandled rejection.
    promise.catch(() => {
      if (cache.get(path) === entry) cache.delete(path);
    });
    return entry;
  };

  /**
   * Preload a link when it is eligible.
   *
   * @param anchor - The link, or nothing.
   * @example
   * preloadLink(document.querySelector("a"));
   */
  const preloadLink = (anchor: HTMLAnchorElement | null | undefined): void => {
    const path = pathOf(anchor);
    if (path !== undefined) start(path);
  };

  /**
   * Start queued `"visible"` preloads while fewer than 2 are in flight.
   *
   * @example
   * cancelDrain = whenIdle(drain);
   */
  const drain = (): void => {
    cancelDrain = undefined;
    while (visibleInFlight < VISIBLE_CONCURRENCY) {
      const path = queue.shift();
      if (path === undefined) return;
      const entry = start(path);
      if (!entry) continue;
      visibleInFlight += 1;
      // Settled either way (taken, failed or evicted): free the slot, drain the rest.
      entry.promise
        .catch(() => "")
        .then(() => {
          visibleInFlight -= 1;
          scheduleDrain();
        });
    }
  };

  /**
   * Drain the queue in idle time, once.
   *
   * @example
   * scheduleDrain();
   */
  const scheduleDrain = (): void => {
    if (cancelDrain === undefined && queue.length > 0) cancelDrain = whenIdle(drain);
  };

  /**
   * `pointerdown` / `touchstart`: preload at once.
   *
   * @param event - The press.
   * @example
   * document.addEventListener("pointerdown", onPress, PRESS);
   */
  const onPress = (event: Event): void => {
    preloadLink(anchorOf(event));
  };

  /**
   * `mouseover`: preload after 65 ms on the link.
   *
   * @param event - The mouse event.
   * @example
   * document.addEventListener("mouseover", onOver, HOVER);
   */
  const onOver = (event: MouseEvent): void => {
    const anchor = anchorOf(event);
    if (!anchor || hoverTimers.has(anchor)) return;
    const timer = setTimeout(() => {
      hoverTimers.delete(anchor);
      preloadLink(anchor);
    }, HOVER_DELAY_MS);
    hoverTimers.set(anchor, timer);
  };

  /**
   * `mouseout`: cancel the hover timer, unless the mouse only moved inside the same link.
   *
   * @param event - The mouse event.
   * @example
   * document.addEventListener("mouseout", onOut, HOVER);
   */
  const onOut = (event: MouseEvent): void => {
    const anchor = anchorOf(event);
    const into = event.relatedTarget;
    if (!anchor || (into instanceof Node && anchor.contains(into))) return;
    clearTimeout(hoverTimers.get(anchor));
    hoverTimers.delete(anchor);
  };

  // "visible" without IntersectionObserver (an old browser) behaves as "intent".
  const observer =
    options.mode === "visible" && typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries, self) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            self.unobserve(entry.target);
            const path = pathOf(entry.target.closest("a"));
            if (path !== undefined) queue.push(path);
          }
          scheduleDrain();
        })
      : undefined;

  document.addEventListener("pointerdown", onPress, PRESS);
  document.addEventListener("touchstart", onPress, PRESS);
  document.addEventListener("mouseover", onOver, HOVER);
  document.addEventListener("mouseout", onOut, HOVER);

  return {
    /**
     * Take the preload for `path` and remove it (see {@link Prefetcher.take}).
     *
     * @param path - The page path.
     * @returns The page HTML promise, or `undefined`.
     * @example
     * prefetcher.take("/about");
     */
    take(path: string): Promise<string> | undefined {
      const entry = cache.get(path);
      if (!entry) return undefined;
      if (isExpired(entry)) {
        drop(path, entry);
        return undefined;
      }
      cache.delete(path);
      return entry.promise;
    },
    /**
     * Watch every eligible link in the document (see {@link Prefetcher.observe}).
     *
     * @example
     * prefetcher.observe();
     */
    observe() {
      if (!observer) return;
      observer.disconnect();
      // The old page's queued links are not preloaded on the new page.
      queue.length = 0;
      for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        if (pathOf(anchor) !== undefined) observer.observe(anchor);
      }
    },
    /**
     * Release everything (see {@link Prefetcher.dispose}).
     *
     * @example
     * prefetcher.dispose();
     */
    dispose() {
      document.removeEventListener("pointerdown", onPress, PRESS);
      document.removeEventListener("touchstart", onPress, PRESS);
      document.removeEventListener("mouseover", onOver, HOVER);
      document.removeEventListener("mouseout", onOut, HOVER);
      observer?.disconnect();
      for (const timer of hoverTimers.values()) clearTimeout(timer);
      hoverTimers.clear();
      cancelDrain?.();
      cancelDrain = undefined;
      queue.length = 0;
      for (const [key, entry] of cache) drop(key, entry);
    }
  };
}

/**
 * The HTML loader the kernel hands to `performNavigation`: a preloaded page when there is
 * one, else a normal fetch. A failed preload falls through to one real fetch, so it never
 * leads to a full reload; only a failed real fetch does, as without preloading.
 *
 * @param prefetcher - The live preloader, or `null` (mode `false`, or stopped).
 * @param path - The page path (pathname + search).
 * @param signal - The navigation's abort signal; never passed to the preload.
 * @returns The page HTML.
 * @throws {Error} When the real fetch fails, or the navigation was aborted after its preload failed.
 * @example
 * await loadWithPrefetch(state.prefetch, "/about", signal); // the preloaded HTML, no new request
 */
export async function loadWithPrefetch(
  prefetcher: Prefetcher | null,
  path: string,
  signal?: AbortSignal
): Promise<string> {
  const hit = prefetcher?.take(path);
  if (hit) {
    try {
      return await hit;
    } catch {
      // A superseded navigation starts no new request.
      signal?.throwIfAborted();
    }
  }
  return fetchPage(path, signal);
}
