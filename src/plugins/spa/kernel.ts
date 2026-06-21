/**
 * @file spa plugin — pure SPA kernel factory + onInit wiring helper.
 *
 * `createSpaKernel(state, config, emit, deps)` is a PURE factory: it closes over
 * the injected state/config/emit/deps only — never the Moku ctx, never module
 * singletons. It is unit-testable with a mock state object and a spy emit.
 * @see README.md
 */

import { dataPlugin } from "../data";
import { headPlugin } from "../head";
import { routerPlugin } from "../router";
import { isClientOnlyRoute } from "../router/iso-match";
import type { RouteContext, RouteDefinition, RouteState } from "../router/types";
import { syncHead } from "./head";
import {
  notifyNavEnd,
  notifyNavStart,
  type RouteSlice,
  scanAndMount,
  unmountAll,
  unmountPageSpecific
} from "./islands";
import { createProgressBar, type ProgressBar } from "./progress";
import {
  attachRouter,
  type NavigateFunction,
  performNavigation,
  type RouterHandlers,
  runSwap,
  swapRegion
} from "./router";
import { resolveSpaConfig } from "./state";
import type {
  // eslint-disable-next-line unicorn/prevent-abbreviations -- canonical public type name per spec
  IslandDef,
  SpaConfig,
  SpaContext,
  SpaEmitFunction,
  SpaKernel,
  SpaKernelDeps,
  SpaState
} from "./types";

/** Emit signature handed to the kernel (spy-able in unit tests). */
export type SpaEmit = SpaEmitFunction;

/** Error prefix for spa kernel failures (spec/11 Part-3). */
const ERROR_PREFIX = "[web]";

/**
 * Registers a island definition into state (last-registered-wins).
 *
 * @param state - The plugin state holding registeredIslands.
 * @param island - The island definition to register.
 * @example
 * registerIsland(state, counter);
 */
export function registerIsland(state: SpaState, island: IslandDef): void {
  state.registeredIslands.set(island.name, island);
}

/**
 * Resolve the current document URL (pathname + search), or `""` when headless.
 *
 * @returns The current URL string.
 * @example
 * const url = currentLocationUrl();
 */
function currentLocationUrl(): string {
  if (typeof document === "undefined") return "";
  return location.pathname + location.search;
}

/**
 * Apply the matched route's `head` config to the live document (minimal client
 * head-sync for the DATA path: title only — the full meta sync runs on the
 * HTML-over-fetch path from the fetched `<head>`). The title is resolved through
 * `head.composeTitle` — the SAME composition `render` uses (`titleTemplate` applied;
 * a route-pinned `title` element wins) — so a client-side navigation's
 * `document.title` matches the SSG output instead of the raw route title.
 *
 * @param head - The head plugin API (resolves the final templated title).
 * @param route - The matched route definition.
 * @param routeContext - The render context (params/data/locale).
 * @example
 * syncDataHead(deps.head, hit.route, { params, data, locale });
 */
function syncDataHead(
  head: SpaKernelDeps["head"],
  route: RouteDefinition,
  routeContext: RouteContext<RouteState>
): void {
  document.title = head.composeTitle(route._handlers.head?.(routeContext));
}

/**
 * Builds the single shared SPA kernel — a pure factory over state/config/emit.
 * Unit-testable with a mock state object and a spy emit; no Moku ctx involved.
 *
 * @param state - The plugin state (all kernel data lives here).
 * @param config - The raw spa config (defaults resolved internally on init).
 * @param emit - The event emitter for spa lifecycle events.
 * @param deps - Resolved router + head APIs reused by the kernel.
 * @returns The single shared {@link SpaKernel}.
 * @example
 * const kernel = createSpaKernel(state, config, emit, { router, head });
 */
export function createSpaKernel(
  state: SpaState,
  config: SpaConfig,
  emit: SpaEmit,
  deps: SpaKernelDeps
): SpaKernel {
  const resolved = resolveSpaConfig(config);
  let progress: ProgressBar | undefined;
  // Scroll intent for the in-flight navigation, applied as the swap's `beforeCapture`
  // (just before the View Transition snapshot). `true` for forward navs (scroll to top),
  // `false` for traverse (back/forward keeps its restored position). Set by `navigate`.
  let pendingScrollToTop = true;

  /**
   * Apply the in-flight navigation's scroll intent — the swap's `beforeCapture` hook.
   * For a forward nav it scrolls to top BEFORE the swap (and, with view transitions on,
   * before the "old" snapshot is captured), so the old and new states share scrollY=0:
   * no delta for a transition to animate → a `position: sticky` header never un-pins.
   * Traverse (back/forward) sets `pendingScrollToTop = false` and restores its saved
   * position after the swap instead.
   *
   * The reset is ALWAYS `"instant"`, never the CSS-driven `"auto"`. It runs synchronously
   * immediately before the swap, and the swap mutates document height (the outgoing page is
   * usually taller than the incoming one). A smooth scroll — from `behavior: "smooth"` or a
   * page `scroll-behavior: smooth` that `"auto"` would inherit — is still animating when that
   * height change lands; the browser clamps scrollY to the new, smaller maximum and cancels
   * the in-flight animation there (worst on WebKit), stranding the page near the OLD position
   * instead of the top. Instant lands scrollY=0 before the swap, every time. (A smooth
   * scroll-to-top on the SAME page is unaffected — the router's same-page handler animates
   * it, where there is no swap to race.)
   *
   * @example
   * runSwap(renderAndMount, viewTransitions, applyPendingScroll);
   */
  const applyPendingScroll = (): void => {
    if (!pendingScrollToTop) return;
    // ALWAYS instant — a smooth reset would race the synchronous, height-changing swap and
    // get cancelled at the clamp point (see above). Never `"auto"`/CSS-driven here.
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  /**
   * Build the matched-route slice (params/meta/locale/url) for the island context at `path`,
   * so islands read their route's params/meta directly. An unmatched path yields an empty slice.
   *
   * @param path - The URL (pathname + search) to match.
   * @returns The route slice for the matched route.
   * @example
   * scanAndMount(state, emit, resolved.swapSelector, islandRouteContext(pathname));
   */
  const islandRouteContext = (path: string): RouteSlice => {
    const matchPath = path.split("?")[0] ?? path;
    const hit = deps.router.match(matchPath);
    const locale =
      hit?.params.lang ??
      (typeof document === "undefined" ? "" : document.documentElement.lang) ??
      "";
    return {
      params: hit?.params ?? {},
      meta: hit?.route._meta ?? {},
      locale,
      // eslint-disable-next-line jsdoc/require-jsdoc -- inline link builder; delegates to router.toUrl
      url: (name, params = {}) => deps.router.toUrl(name, params)
    };
  };

  /**
   * Process one navigation: head-sync, unmount, swap, re-mount, emit navigated.
   * When the region cannot be swapped (either document lacks the swap selector)
   * the SPA nav cannot complete — the head is already synced and the islands torn
   * down, so finishing would leave the OLD body under a NEW URL with a `spa:navigated`
   * claiming success. Fall back to a full browser navigation instead (mirroring
   * {@link performNavigation}'s fetch-error fallback).
   *
   * @param html - The fetched page HTML.
   * @param pathname - The destination pathname.
   * @example
   * handleEnd("<html>…</html>", "/about");
   */
  const handleEnd = (html: string, pathname: string): void => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    syncHead(deps.head, doc);
    unmountPageSpecific(state, emit);
    const swapped = swapRegion(
      doc,
      resolved.swapSelector,
      resolved.viewTransitions,
      () => {
        const routeSlice = islandRouteContext(pathname);
        scanAndMount(state, emit, resolved.swapSelector, routeSlice);
        notifyNavEnd(state, routeSlice);
      },
      applyPendingScroll
    );
    if (!swapped) {
      handleError();
      location.href = pathname;
      return;
    }
    state.currentUrl = pathname;
    progress?.done();
    emit("spa:navigated", { url: pathname });
  };

  /**
   * Begin a navigation: start progress, notify islands, emit navigate.
   *
   * @param pathname - The destination pathname.
   * @example
   * handleStart("/about");
   */
  const handleStart = (pathname: string): void => {
    progress?.start();
    notifyNavStart(state);
    emit("spa:navigate", { from: state.currentUrl, to: pathname });
  };

  /**
   * Finish the progress bar after a failed navigation (full-reload fallback).
   *
   * @example
   * handleError();
   */
  const handleError = (): void => {
    progress?.done();
  };

  // `navigate` announces the nav (handleStart) ONCE, up front, before either path runs its
  // fetch — so the DATA path shows progress during its JSON load, not only after it. The HTML
  // fallback goes through `performNavigation`, which also calls `onStart`; the kernel passes a
  // no-op here so the same navigation is never announced twice.
  const handlers: RouterHandlers = {
    // eslint-disable-next-line jsdoc/require-jsdoc -- nav-start is done once by navigate()
    onStart: () => {},
    onEnd: handleEnd,
    onError: handleError
  };

  /**
   * The product of a successful {@link resolveDataRender}: the matched route, the
   * VNode produced by its `render`, the route context (for head-sync), and the
   * live swap-region element to render into.
   */
  interface ResolvedDataRender {
    /** The matched route definition (its `render`/`head` handlers are reused). */
    route: RouteDefinition;
    /** The Preact VNode produced by the route's own `render`. */
    vnode: ReturnType<NonNullable<RouteDefinition["_handlers"]["render"]>>;
    /** The render context (params/data/locale/url) reused for head-sync. */
    routeContext: RouteContext<RouteState>;
    /** The live swap-region element the VNode renders into. */
    region: Element;
  }

  /**
   * Phase 1 of the client DATA path (no side effects): match `pathname`, fetch the
   * page's PERSISTED data via the `data` reader, build the {@link RouteContext}, run
   * the route's OWN `render` (the same component the build used for SSG), and locate
   * the live swap region. The fetched JSON is used DIRECTLY as `ctx.data` (no
   * validation step — `route.parse` was removed). Returns `false` (committing
   * nothing) on no-`data`-reader / no-match / no-render / no-region / fetch-miss,
   * so the caller falls back to HTML-over-fetch.
   *
   * @param pathname - The destination pathname (search stripped for matching).
   * @returns The resolved render inputs, or `false` when the DATA path cannot run.
   * @example
   * const resolved = await resolveDataRender("/en/world/");
   */
  const resolveDataRender = async (pathname: string): Promise<ResolvedDataRender | false> => {
    const matchPath = pathname.split("?")[0] ?? pathname;
    const hit = deps.router.match(matchPath);
    if (!hit?.route._handlers.render) return false;

    // Resolve this page's `ctx.data`:
    //   • spa client-only route (dynamic, no `.generate()`) — the build emitted no static HTML and
    //     no data sidecar for it (HTML-over-fetch would 404), and it has no build-time data. Render
    //     from the URL with `{}`; its islands fetch whatever they need. Works with no `data` plugin.
    //   • any other route — read the persisted sidecar via the `data` reader (the build wrote it from
    //     `.load()`). No reader, or a miss, degrades to HTML-over-fetch (the route's real static HTML).
    let data: unknown = {};
    if (!isClientOnlyRoute(deps.router.mode(), hit.route)) {
      if (!deps.dataAt) return false;
      const persisted = await deps.dataAt(pathname); // persisted JSON (unknown) — null on miss
      if (persisted === null) return false;
      data = persisted;
    }

    // Build the render context directly from the resolved payload (no validation step):
    // the build wrote this JSON from `load()`, so it IS this page's `ctx.data`.
    const locale = hit.params.lang ?? document.documentElement.lang ?? "";
    const routeContext: RouteContext<RouteState> = {
      params: hit.params,
      data,
      locale,
      meta: hit.route._meta,
      // eslint-disable-next-line jsdoc/require-jsdoc -- inline link builder; delegates to router.toUrl
      url: (routeName, routeParams = {}) => deps.router.toUrl(routeName, routeParams)
    };

    // Render the route's OWN component (the same one SSG used) and locate its swap region.
    // NB: the route's `.layout()` is intentionally NOT applied here. The layout
    // chrome (TopBar/TabNav/Footer) is persistent — rendered once by SSG and left
    // in place across navigations. Client nav replaces ONLY the inner swap region
    // (`resolved.swapSelector`); re-running the layout would destroy and recreate
    // the chrome. The layout is therefore an SSG-only concern (see build/pages).
    const vnode = hit.route._handlers.render(routeContext);
    const region = document.querySelector(resolved.swapSelector);
    if (!region) return false;

    return { route: hit.route, vnode, routeContext, region };
  };

  /**
   * Phase 2 of the client DATA path (all side effects): begin the navigation,
   * lazy-load the Preact render layer, sync the document head, unmount the
   * outgoing page-specific islands, swap the VNode into the region, re-mount, then
   * record the new URL and emit `spa:navigated`.
   *
   * @param pathname - The destination pathname (recorded as the new current URL).
   * @param resolvedRender - The inputs produced by {@link resolveDataRender}.
   * @param signal - Aborts when this navigation is superseded (`navEvent.signal`).
   * @example
   * await commitDataRender("/en/world/", resolved);
   */
  const commitDataRender = async (
    pathname: string,
    resolvedRender: ResolvedDataRender,
    signal?: AbortSignal
  ): Promise<void> => {
    // A superseded navigation must never apply its swap: the abort can land while
    // resolveDataRender awaited the data fetch — bail before any side effect.
    if (signal?.aborted) return;

    // The nav was already announced by `navigate` (before the data fetch); here just lazy-load
    // the Preact render layer on demand.
    const { route, vnode, routeContext, region } = resolvedRender;
    const { renderVNode } = await import("./render");

    // Re-check after the async import: the abort can also land while it loads.
    if (signal?.aborted) return;

    // Sync the document head and tear down the outgoing page-specific islands.
    syncDataHead(deps.head, route, routeContext);
    unmountPageSpecific(state, emit);
    const routeSlice = islandRouteContext(pathname);

    /**
     * Render the VNode into the region and re-mount its islands in one paint — the
     * swap body handed to `runSwap` (optionally wrapped in a View Transition).
     *
     * @example
     * ```ts
     * runSwap(renderAndMount, resolved.viewTransitions, applyPendingScroll);
     * ```
     */
    const renderAndMount = (): void => {
      // `renderVNode` clears the static SSR children on first render into this region,
      // then lets Preact own + diff it on subsequent navs (clearing again would desync
      // Preact's retained vdom from the live DOM → a blank region on the next nav).
      renderVNode(vnode, region);
      scanAndMount(state, emit, resolved.swapSelector, routeSlice);
      notifyNavEnd(state, routeSlice);
    };
    runSwap(renderAndMount, resolved.viewTransitions, applyPendingScroll);

    // Record the new URL and announce the completed navigation.
    state.currentUrl = pathname;
    progress?.done();
    emit("spa:navigated", { url: pathname });
  };

  /**
   * The client DATA path: resolve the matched route's render inputs from the
   * page's PERSISTED data ({@link resolveDataRender}), then commit the Preact swap
   * ({@link commitDataRender}). The fetched JSON is used DIRECTLY as `ctx.data`
   * (no validation step). `route.load` does NOT run on the client — the build
   * already persisted its output. Returns `false` (touching nothing the fallback
   * cares about) on no-match / no-render / null / throw, so the caller falls back
   * to HTML-over-fetch.
   *
   * @param pathname - The destination pathname (search stripped for matching).
   * @param signal - Aborts when this navigation is superseded (`navEvent.signal`).
   * @returns `true` if the route was rendered from its data, else `false`.
   * @example
   * if (await tryDataRender("/en/world/")) return;
   */
  const tryDataRender = async (pathname: string, signal?: AbortSignal): Promise<boolean> => {
    try {
      const resolvedRender = await resolveDataRender(pathname);
      if (resolvedRender === false) return false;
      await commitDataRender(pathname, resolvedRender, signal);
      return true;
    } catch {
      // The DATA path threw mid-flight → fall back to HTML-over-fetch. The progress bar that
      // `navigate` already started stays up and is cleared by the fallback's handleEnd/onError.
      return false;
    }
  };

  /**
   * Initial-load render for a spa client-only route (dynamic, no `.generate()`): the build emitted
   * no static HTML for it, so the host served a fallback shell. Client-render the matched route into
   * the swap region from the URL, then mount its islands — the deep-link / refresh paint. Unlike a
   * navigation there is nothing to unmount and no `spa:navigated` to emit. If the route cannot be
   * resolved (defensive — a matched client-only route always resolves), fall back to mounting the
   * served body so boot still wires up whatever islands the shell does carry.
   *
   * @param pathname - The current document path (pathname + search).
   * @example
   * await bootRender("/b/abc123");
   */
  const bootRender = async (pathname: string): Promise<void> => {
    const routeSlice = islandRouteContext(pathname);
    const resolvedRender = await resolveDataRender(pathname);
    if (resolvedRender === false) {
      scanAndMount(state, emit, resolved.swapSelector, routeSlice);
      return;
    }
    const { vnode, region } = resolvedRender;
    const { renderVNode } = await import("./render");
    renderVNode(vnode, region);
    scanAndMount(state, emit, resolved.swapSelector, routeSlice);
  };

  /**
   * Unified navigation: try the client DATA path first (only when the `data`
   * plugin is composed), then fall back to HTML-over-fetch (which itself falls
   * back to a full `location.href` reload). Injected into the router so every
   * navigation entry point (Navigation API, History, programmatic) goes through it.
   *
   * @param pathname - The destination pathname.
   * @param scrollToTop - Whether the swap should scroll to top before its snapshot
   *   (default `true`; forward navs). Traverse passes `false` to keep its restored scroll.
   * @param signal - Aborts when this navigation is superseded (`navEvent.signal`);
   *   a superseded navigation never applies its swap (no stale last-write-wins).
   * @returns A promise resolving once the swap (or fallback) is dispatched.
   * @example
   * await navigate("/en/world/");
   */
  const navigate: NavigateFunction = async (
    pathname: string,
    scrollToTop = true,
    signal?: AbortSignal
  ): Promise<void> => {
    // Record the scroll intent for this navigation's swap (read by `applyPendingScroll`,
    // run just before the snapshot). Forward navs scroll to top; traverse keeps its scroll.
    pendingScrollToTop = scrollToTop;
    // Announce the nav (progress bar + onNavStart + `spa:navigate`) NOW, before either path
    // runs its fetch. The DATA path awaits the persisted JSON inside `resolveDataRender`; doing
    // this here — not in `commitDataRender`, which runs AFTER that fetch — means the user sees
    // feedback during the network load instead of a dead pause. Mirrors the HTML path's onStart.
    handleStart(pathname);
    if (deps.router.mode() !== "ssg" && (await tryDataRender(pathname, signal))) return;
    // Superseded while the DATA path resolved — never start the HTML fallback.
    if (signal?.aborted) return;
    await performNavigation(pathname, handlers, signal);
  };

  return {
    /**
     * Register config islands and seed currentUrl from the document.
     *
     * @example
     * kernel.init();
     */
    init(): void {
      for (const island of resolved.islands) registerIsland(state, island);
      state.currentUrl = currentLocationUrl();
    },
    /**
     * Boot navigation interception + initial scan (throws if already started).
     *
     * @example
     * kernel.boot();
     */
    boot(): void {
      // Boot is a client-only, single-shot operation — no-op headless, throw on re-boot.
      if (typeof document === "undefined") return;
      if (state.started) {
        throw new Error(
          `${ERROR_PREFIX} spa kernel already started.\n  Call app.stop() before booting again (single boot per app).`
        );
      }

      // Stand up the progress bar and seed the current URL from the live document.
      progress = createProgressBar(resolved.progressBar);
      state.currentUrl = currentLocationUrl();
      state.destroyRouter = attachRouter(handlers, navigate);

      // Initial island mount. In spa mode a client-only route (dynamic, no `.generate()`) was NOT
      // pre-rendered — the host served a fallback shell — so client-render the matched route from the
      // URL before mounting, so a deep-link / refresh paints the right page. Every pre-rendered route
      // (static, or dynamic WITH `.generate()`) is hydrated directly from its own served HTML.
      const matchPath = state.currentUrl.split("?")[0] ?? state.currentUrl;
      const hit = deps.router.match(matchPath);
      if (hit?.route._handlers.render && isClientOnlyRoute(deps.router.mode(), hit.route)) {
        void bootRender(state.currentUrl);
      } else {
        scanAndMount(state, emit, resolved.swapSelector, islandRouteContext(state.currentUrl));
      }
      state.started = true;
    },
    /**
     * Register a island definition (last-registered-wins).
     *
     * @param island - The island definition to register.
     * @example
     * kernel.register(counter);
     */
    register(island): void {
      registerIsland(state, island);
    },
    /**
     * Process a navigation to `path` (fetch then swap; full reload on error).
     *
     * @param path - The target path to navigate to.
     * @example
     * kernel.processNav("/about");
     */
    processNav(path): void {
      if (typeof document === "undefined") return;
      navigate(path).catch(() => {});
    },
    /**
     * Scan the swap region and mount islands for matching elements.
     *
     * @example
     * kernel.scan();
     */
    scan(): void {
      scanAndMount(state, emit, resolved.swapSelector, islandRouteContext(state.currentUrl));
    },
    /**
     * Tear down router listeners, dispose all instances, reset boot state.
     *
     * @example
     * kernel.dispose();
     */
    dispose(): void {
      state.destroyRouter?.();
      // eslint-disable-next-line unicorn/no-null -- `destroyRouter` is `(() => void) | null`; nulled to mirror onStart
      state.destroyRouter = null;
      unmountAll(state, emit);
      progress = undefined;
      state.started = false;
    }
  };
}

/**
 * Builds the shared kernel from the plugin context, stores it on `ctx.state`,
 * and runs its init step (validate config, register config.islands, seed
 * currentUrl). Captures the OPTIONAL `data` reader when the `data` plugin is
 * composed (enabling client DATA navigation) — resolved by instance via
 * `ctx.require(dataPlugin)`, guarded by `ctx.has("data")` so `data` stays optional
 * (`spa`'s `depends` is `[router, head]`).
 *
 * @param ctx - The plugin context (state/config/emit/require/has/log).
 * @example
 * initSpa(ctx);
 */
export function initSpa(ctx: SpaContext): void {
  const deps: SpaKernelDeps = {
    router: ctx.require(routerPlugin),
    head: ctx.require(headPlugin)
  };
  // OPTIONAL: enable client DATA navigation only when the `data` plugin is composed.
  if (ctx.has("data")) {
    const reader = ctx.require(dataPlugin);
    // eslint-disable-next-line jsdoc/require-jsdoc -- thin adapter binding the reader's `at`
    deps.dataAt = (path: string) => reader.at(path);
  }
  const kernel = createSpaKernel(ctx.state, ctx.config, ctx.emit, deps);
  ctx.state.kernel = kernel;
  kernel.init();
}

/** Re-export the config defaults + resolver for the kernel test surface. */
export { defaultSpaConfig, resolveSpaConfig } from "./state";
