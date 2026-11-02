/**
 * @file data plugin — browser preload of every page's data (`preload: "all"`).
 *
 * After the app starts and the main thread is idle, fetch the one bundle file
 * the build wrote (`<baseUrl>_all.json`) and fill the `at()` cache with every
 * path not already cached. Node-free. Does nothing on Node, with `preload:
 * "none"`, or when the user asked the browser to save data. A failed fetch is
 * silent: `at()` keeps fetching single files lazily.
 */
import type { DataPluginContext } from "./api";
import { BUNDLE_FILE } from "./convention";

/** Upper bound for the idle wait, so a busy page still preloads. */
const IDLE_TIMEOUT_MS = 2000;

/**
 * Reports whether the user asked the browser to reduce data use.
 *
 * @returns `true` when `navigator.connection.saveData` is on.
 * @example
 * ```ts
 * if (saveDataOn()) return;
 * ```
 */
function saveDataOn(): boolean {
  const nav = globalThis.navigator as { connection?: { saveData?: boolean } } | undefined;
  return nav?.connection?.saveData === true;
}

/**
 * Runs `task` when the main thread is idle, with a `setTimeout` fallback where
 * `requestIdleCallback` is missing.
 *
 * @param task - The work to run.
 * @returns A function that cancels the scheduled run.
 * @example
 * ```ts
 * const cancel = whenIdle(() => console.log("idle"));
 * ```
 */
function whenIdle(task: () => void): () => void {
  if (typeof globalThis.requestIdleCallback === "function") {
    const handle = globalThis.requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS });
    return () => globalThis.cancelIdleCallback(handle);
  }
  const timer = setTimeout(task, 0);
  return () => clearTimeout(timer);
}

/**
 * Fetches the bundle and caches every path not already cached. Never rejects.
 * Clears the in-flight slot and the cancel hook when it settles.
 *
 * @param ctx - The data plugin context.
 * @param signal - Aborts the fetch on stop.
 * @returns Resolves once the cache is filled or the fetch failed.
 * @example
 * ```ts
 * await fillFromBundle(ctx, new AbortController().signal);
 * ```
 */
async function fillFromBundle(ctx: DataPluginContext, signal: AbortSignal): Promise<void> {
  try {
    const response = await fetch(`${ctx.config.baseUrl}${BUNDLE_FILE}`, { signal });
    if (!response.ok) return;
    const bundle = (await response.json()) as Record<string, unknown>;
    if (signal.aborted) return;
    for (const [path, data] of Object.entries(bundle)) {
      if (!ctx.state.cache.has(path)) ctx.state.cache.set(path, data);
    }
  } catch {
    // Silent: a missing or broken bundle leaves lazy at() working.
  } finally {
    // eslint-disable-next-line unicorn/no-null -- no bundle in flight any more
    ctx.state.bundle = null;
    // eslint-disable-next-line unicorn/no-null -- nothing left to cancel
    ctx.state.cancelPreload = null;
  }
}

/**
 * Schedules the bundle preload for `preload: "all"` in a browser. A no-op on
 * Node, with `preload: "none"`, with save-data on, or when already scheduled.
 *
 * @param ctx - The data plugin context.
 * @example
 * ```ts
 * startPreload(ctx); // from onStart
 * ```
 */
export function startPreload(ctx: DataPluginContext): void {
  if (ctx.config.preload !== "all") return;
  if (typeof document === "undefined") return;
  if (ctx.state.cancelPreload || ctx.state.bundle) return;
  if (saveDataOn()) return;

  const controller = new AbortController();
  const abort = controller.abort.bind(controller);
  const cancelIdle = whenIdle(() => {
    ctx.state.cancelPreload = abort;
    ctx.state.bundle = fillFromBundle(ctx, controller.signal);
  });
  ctx.state.cancelPreload = cancelAll(cancelIdle, abort);
}

/**
 * Combines the two cancel steps of a scheduled preload into one hook.
 *
 * @param cancelIdle - Cancels the idle callback.
 * @param abort - Aborts the bundle fetch.
 * @returns One function that runs both.
 * @example
 * ```ts
 * ctx.state.cancelPreload = cancelAll(cancelIdle, abort);
 * ```
 */
function cancelAll(cancelIdle: () => void, abort: () => void): () => void {
  return function cancel(): void {
    cancelIdle();
    abort();
  };
}

/**
 * Cancels a scheduled preload or aborts the bundle fetch in flight.
 *
 * @param ctx - The data plugin context.
 * @example
 * ```ts
 * stopPreload(ctx); // from onStop
 * ```
 */
export function stopPreload(ctx: DataPluginContext): void {
  ctx.state.cancelPreload?.();
  // eslint-disable-next-line unicorn/no-null -- nothing scheduled any more
  ctx.state.cancelPreload = null;
}
