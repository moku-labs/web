/**
 * @file data plugin — browser preload of all page data (`preload: "all"`). See README.
 */
import type { DataPluginContext } from "./api";
import { BUNDLE_FILE } from "./convention";

/**
 * Fetches the bundle and caches every path not already cached. Never rejects:
 * a failed fetch leaves lazy `at()` working. Clears `cancelPreload` when done.
 *
 * @param ctx - The data plugin context.
 * @param signal - Aborts the fetch on stop.
 * @returns Resolves when the fill is done or failed.
 * @example
 * ```ts
 * await fill(ctx, signal);
 * ```
 */
async function fill(ctx: DataPluginContext, signal: AbortSignal): Promise<void> {
  try {
    const response = await fetch(`${ctx.config.baseUrl}${BUNDLE_FILE}`, { signal });
    const bundle = response.ok ? ((await response.json()) as Record<string, unknown>) : {};
    for (const [path, data] of Object.entries(bundle)) {
      if (!signal.aborted && !ctx.state.cache.has(path)) ctx.state.cache.set(path, data);
    }
  } catch {
    // Silent on purpose.
  } finally {
    // eslint-disable-next-line unicorn/no-null -- nothing in flight
    ctx.state.cancelPreload = null;
  }
}

/**
 * From `onStart`: when idle, fetch `<baseUrl>_all.json` once and fill the cache.
 * No-op on Node, with `preload: "none"`, with save-data on, or if already scheduled.
 *
 * @param ctx - The data plugin context.
 * @example
 * ```ts
 * startPreload(ctx);
 * ```
 */
export function startPreload(ctx: DataPluginContext): void {
  const nav = globalThis.navigator as { connection?: { saveData?: boolean } } | undefined;
  const skip =
    ctx.config.preload !== "all" ||
    typeof document === "undefined" ||
    ctx.state.cancelPreload !== null ||
    nav?.connection?.saveData === true;
  if (skip) return;

  const controller = new AbortController();
  // eslint-disable-next-line jsdoc/require-jsdoc -- inline
  const run = (): void => {
    void fill(ctx, controller.signal);
  };
  const idle = typeof requestIdleCallback === "function";
  const handle = idle ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 0);
  // eslint-disable-next-line jsdoc/require-jsdoc -- inline
  ctx.state.cancelPreload = () => {
    if (idle) cancelIdleCallback(handle as number);
    else clearTimeout(handle);
    controller.abort();
  };
}

/**
 * From `onStop`: cancel the idle callback or abort the bundle fetch.
 *
 * @param ctx - The data plugin context.
 * @example
 * ```ts
 * stopPreload(ctx);
 * ```
 */
export function stopPreload(ctx: DataPluginContext): void {
  ctx.state.cancelPreload?.();
  // eslint-disable-next-line unicorn/no-null -- nothing scheduled
  ctx.state.cancelPreload = null;
}
