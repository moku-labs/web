/**
 * @file spa plugin — pure SPA kernel factory + onInit wiring helper.
 *
 * `createSpaKernel(state, config, emit, deps)` is a PURE factory: it closes over
 * the injected state/config/emit/deps only — never the Moku ctx, never module
 * singletons. It is unit-testable with a mock state object and a spy emit.
 * @see README.md
 */

import { headPlugin } from "../head";
import { routerPlugin } from "../router";
import {
  notifyNavEnd,
  notifyNavStart,
  scanAndMount,
  unmountAll,
  unmountPageSpecific
} from "./components";
import { syncHead } from "./head";
import { createProgressBar, type ProgressBar } from "./progress";
import { attachRouter, performNavigation, type RouterHandlers, swapRegion } from "./router";
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
 * Module-scope holder for the active SPA kernel. `onStop` receives the minimal
 * teardown context (no `state`/`require`), so the kernel built during `onInit`
 * is parked here for disposal. Single-app-per-process by design (spec/08 §4).
 *
 * @example
 * kernelRef.current = createSpaKernel(state, config, emit, deps);
 */
export const kernelRef: { current?: SpaKernel } = {};

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
          `${ERROR_PREFIX} spa kernel already started\n  → call app.stop() before booting again (single boot per app)`
        );
      }
      progress = createProgressBar(resolved.progressBar);
      state.currentUrl = currentLocationUrl();
      state.destroyRouter = attachRouter(handlers);
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
      performNavigation(path, handlers).catch(() => {});
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
 * Builds the shared kernel from the plugin context, stores it on `ctx.state`
 * and `kernelRef`, and runs its init step (validate config, register
 * config.components, seed currentUrl). Extracted from index.ts onInit to keep
 * wiring under budget.
 *
 * @param ctx - The plugin context (state/config/emit/require/log).
 * @example
 * initSpa(ctx);
 */
export function initSpa(ctx: SpaContext): void {
  const kernel = createSpaKernel(ctx.state, ctx.config, ctx.emit, {
    router: ctx.require(routerPlugin),
    head: ctx.require(headPlugin)
  });
  ctx.state.kernel = kernel;
  kernelRef.current = kernel;
  kernel.init();
}

/** Re-export the config defaults + resolver for the kernel test surface. */
export { defaultSpaConfig, resolveSpaConfig } from "./state";
