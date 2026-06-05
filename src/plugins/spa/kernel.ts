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
import type { RouteContext, RouteDefinition, RouteState } from "../router/types";
import {
  notifyNavEnd,
  notifyNavStart,
  scanAndMount,
  unmountAll,
  unmountPageSpecific
} from "./components";
import { syncHead } from "./head";
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
  ComponentDef,
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
 * Registers a component definition into state (last-registered-wins).
 *
 * @param state - The plugin state holding registeredComponents.
 * @param component - The component definition to register.
 * @example
 * registerComponent(state, counter);
 */
export function registerComponent(state: SpaState, component: ComponentDef): void {
  state.registeredComponents.set(component.name, component);
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
 * HTML-over-fetch path from the fetched `<head>`).
 *
 * @param route - The matched route definition.
 * @param routeContext - The render context (params/data/locale).
 * @example
 * syncDataHead(hit.route, { params, data, locale });
 */
function syncDataHead(route: RouteDefinition, routeContext: RouteContext<RouteState>): void {
  const title = route._handlers.head?.(routeContext)?.title;
  if (title !== undefined && title !== "") document.title = title;
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

  /**
   * Process one navigation: head-sync, unmount, swap, re-mount, emit navigated.
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
    swapRegion(doc, resolved.swapSelector, resolved.viewTransitions, () => {
      scanAndMount(state, emit, resolved.swapSelector);
      notifyNavEnd(state);
    });
    state.currentUrl = pathname;
    progress?.done();
    emit("spa:navigated", { url: pathname });
  };

  /**
   * Begin a navigation: start progress, notify components, emit navigate.
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

  const handlers: RouterHandlers = {
    onStart: handleStart,
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
    if (!deps.dataAt) return false;
    const matchPath = pathname.split("?")[0] ?? pathname;
    const hit = deps.router.match(matchPath);
    if (!hit?.route._handlers.render) return false;
    const raw = await deps.dataAt(pathname); // persisted JSON (unknown) — null on miss
    if (raw === null) return false;
    // The persisted JSON IS this page's payload (the build wrote it from `load()`),
    // used directly as `ctx.data` — there is no validation step. A malformed/missing
    // file already degrades to the HTML-over-fetch fallback (dataAt → null, or the
    // surrounding try/catch in tryDataRender).
    const data = raw;
    const locale = hit.params.lang ?? document.documentElement.lang ?? "";
    const routeContext: RouteContext<RouteState> = {
      params: hit.params,
      data,
      locale,
      // eslint-disable-next-line jsdoc/require-jsdoc -- inline link builder; delegates to router.toUrl
      url: (routeName, routeParams = {}) => deps.router.toUrl(routeName, routeParams)
    };
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
   * @example
   * await commitDataRender("/en/world/", resolved);
   */
  const commitDataRender = async (
    pathname: string,
    resolvedRender: ResolvedDataRender
  ): Promise<void> => {
    const { route, vnode, routeContext, region } = resolvedRender;
    handleStart(pathname);
    const { renderVNode } = await import("./render");
    syncDataHead(route, routeContext);
    unmountPageSpecific(state, emit);
    runSwap(() => {
      // `renderVNode` clears the static SSR children on first render into this region,
      // then lets Preact own + diff it on subsequent navs (clearing again would desync
      // Preact's retained vdom from the live DOM → a blank region on the next nav).
      renderVNode(vnode, region);
      scanAndMount(state, emit, resolved.swapSelector);
      notifyNavEnd(state);
    }, resolved.viewTransitions);
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
   * @returns `true` if the route was rendered from its data, else `false`.
   * @example
   * if (await tryDataRender("/en/world/")) return;
   */
  const tryDataRender = async (pathname: string): Promise<boolean> => {
    try {
      const resolvedRender = await resolveDataRender(pathname);
      if (resolvedRender === false) return false;
      await commitDataRender(pathname, resolvedRender);
      return true;
    } catch {
      // commitDataRender may have started the progress bar (handleStart) before throwing;
      // clear it so the HTML-over-fetch fallback starts from a clean state.
      progress?.done();
      return false;
    }
  };

  /**
   * Unified navigation: try the client DATA path first (only when the `data`
   * plugin is composed), then fall back to HTML-over-fetch (which itself falls
   * back to a full `location.href` reload). Injected into the router so every
   * navigation entry point (Navigation API, History, programmatic) goes through it.
   *
   * @param pathname - The destination pathname.
   * @returns A promise resolving once the swap (or fallback) is dispatched.
   * @example
   * await navigate("/en/world/");
   */
  const navigate: NavigateFunction = async (pathname: string): Promise<void> => {
    if (deps.router.mode() !== "ssg" && (await tryDataRender(pathname))) return;
    await performNavigation(pathname, handlers);
  };

  return {
    /**
     * Register config components and seed currentUrl from the document.
     *
     * @example
     * kernel.init();
     */
    init(): void {
      for (const component of resolved.components) registerComponent(state, component);
      state.currentUrl = currentLocationUrl();
    },
    /**
     * Boot navigation interception + initial scan (throws if already started).
     *
     * @example
     * kernel.boot();
     */
    boot(): void {
      if (typeof document === "undefined") return;
      if (state.started) {
        throw new Error(
          `${ERROR_PREFIX} spa kernel already started.\n  Call app.stop() before booting again (single boot per app).`
        );
      }
      progress = createProgressBar(resolved.progressBar);
      state.currentUrl = currentLocationUrl();
      state.destroyRouter = attachRouter(handlers, navigate);
      scanAndMount(state, emit, resolved.swapSelector);
      state.started = true;
    },
    /**
     * Register a component definition (last-registered-wins).
     *
     * @param component - The component definition to register.
     * @example
     * kernel.register(counter);
     */
    register(component): void {
      registerComponent(state, component);
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
     * Scan the swap region and mount components for matching elements.
     *
     * @example
     * kernel.scan();
     */
    scan(): void {
      scanAndMount(state, emit, resolved.swapSelector);
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
 * and runs its init step (validate config, register config.components, seed
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
