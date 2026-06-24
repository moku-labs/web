/**
 * @file spa plugin — onStop teardown closure handles + capture/dispose helpers, plus the
 * module-level navigators bound to the running app.
 *
 * Holds the module-scope closure handles `onStop` needs but cannot reach
 * (spec/08 §4: TeardownContext is `{ global }`-only — no `state`/`log`). They are
 * captured during `onStart` and released in `onStop`. Single-app-per-document by
 * design (the only module-scope state is these runtime handles — never kernel data) — which
 * is also why the booted kernel's {@link navigate}/{@link hardNavigate} can be exposed as
 * plain module functions for chrome/nav helpers that have no `app` handle or island `ctx`.
 */

import type { Log } from "@moku-labs/common";
import type { NavigateOptions, SpaContext, SpaKernel } from "./types";

/** Router/instance teardown captured during onStart (undefined when stopped). */
let teardown: (() => void) | undefined;
/** Captured log ref — onStop has no `ctx.log` (spec/08 §4). */
let logRef: Log.LogApi | undefined;
/** The booted app's navigators, or undefined before boot / after stop (single-app-per-document). */
let boundNavigators:
  | {
      navigate: (path: string, options?: NavigateOptions) => void;
      hardNavigate: (url: string) => void;
    }
  | undefined;

/**
 * Bind the running app's navigators from its kernel — called by the plugin's `onStart` after
 * `kernel.boot()`, so the module-level {@link navigate}/{@link hardNavigate} delegate to it.
 *
 * @param kernel - The booted spa kernel.
 * @example
 * bindKernelNavigators(ctx.state.kernel);
 */
export function bindKernelNavigators(kernel: SpaKernel): void {
  boundNavigators = {
    // eslint-disable-next-line jsdoc/require-jsdoc -- thin delegating closure to the kernel
    navigate: (path, options) => kernel.processNav(path, options),
    // eslint-disable-next-line jsdoc/require-jsdoc -- thin delegating closure to the kernel
    hardNavigate: url => kernel.hardNavigate(url)
  };
}

/**
 * Navigate the booted SPA to an internal path — the SAME swap pipeline as a link click,
 * `ctx.navigate`, or `app.spa.navigate`, for module-scope callers with no `app`/island `ctx`.
 * No-op before `app.start()`. Build `path` from the route map's `urls`, never a literal.
 *
 * @param path - The internal destination path (e.g. `urls.toUrl("board", { id })`).
 * @param options - Optional per-navigation overrides (e.g. `{ scroll: "preserve" }`).
 * @example
 * import { navigate } from "@moku-labs/web/browser";
 * navigate(urls.toUrl("issue", { id, issueId }));
 */
export function navigate(path: string, options?: NavigateOptions): void {
  boundNavigators?.navigate(path, options);
}

/**
 * Cross a boundary the SPA cannot swap (a different layout, the auth split) with a REAL
 * full-page load — detaches the SPA interceptor first so the navigation isn't caught and
 * converted to a swap. For module-scope callers with no `app`/island `ctx`. No-op before boot.
 *
 * @param url - The destination URL (internal path or absolute).
 * @example
 * import { hardNavigate } from "@moku-labs/web/browser";
 * hardNavigate(urls.toUrl("signin", {})); // sign-out / 401: leave the app chrome for the auth split
 */
export function hardNavigate(url: string): void {
  boundNavigators?.hardNavigate(url);
}

/**
 * Capture the teardown + log handles during `onStart` (no-op without a DOM —
 * the SSR/build guard, so onStop has nothing to release). The kernel built in
 * `onInit` lives on `ctx.state`; its `dispose` is captured into the teardown
 * closure here. The kernel itself is booted by index.ts after this capture.
 *
 * @param ctx - The plugin context (used for `state.kernel` + `log` capture).
 * @example
 * captureTeardown(ctx);
 */
export function captureTeardown(ctx: SpaContext): void {
  if (typeof document === "undefined") return;
  logRef = ctx.log;
  const kernel = ctx.state.kernel;
  // eslint-disable-next-line jsdoc/require-jsdoc -- teardown closure capturing the kernel for onStop disposal
  teardown = () => kernel?.dispose();
}

/**
 * Release everything `captureTeardown`/`onStart` acquired: run teardown in
 * try/catch (logging via the captured ref), then clear both handles. Idempotent —
 * a second call is a no-op (spec/11 §4.2) and mirrors `onStart` (§4.1).
 *
 * @example
 * disposeSpa();
 */
export function disposeSpa(): void {
  try {
    teardown?.();
  } catch (error) {
    logRef?.error("spa:teardown-failed", {}, error as Error);
  } finally {
    teardown = undefined;
    logRef = undefined;
    boundNavigators = undefined;
  }
}
