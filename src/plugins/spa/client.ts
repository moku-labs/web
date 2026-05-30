/**
 * spa plugin — browser client entry. Imports ONLY pure domain fns, never ctx or
 * any Moku kernel code (keeps the browser bundle server-free). Exposed as the
 * `./spa` framework subpath export.
 *
 * @file spa plugin — browser client entry.
 * @see README.md
 */
import { createSpaKernel } from "./kernel";
import type { SpaConfig, SpaEmitFunction, SpaKernelDeps, SpaState } from "./types";

// eslint-disable-next-line jsdoc/require-jsdoc -- trivial module-private no-op constant
const noopEmit: SpaEmitFunction = () => {};

/**
 * Builds initial client SPA state (no Moku ctx). Mirrors the plugin `createState`
 * but is callable in the browser bundle without the framework.
 *
 * @returns Fresh SPA state with an empty kernel slot.
 * @example
 * const state = createClientState();
 */
export function createClientState(): SpaState {
  return {
    registeredComponents: new Map(),
    instances: new Map(),
    currentUrl: "",
    // eslint-disable-next-line unicorn/no-null -- `(() => void) | null` until the router attaches
    destroyRouter: null,
    started: false,
    // eslint-disable-next-line unicorn/no-null -- `SpaKernel | null` until boot builds it
    kernel: null
  };
}

/**
 * Boots the SPA runtime in the browser: builds the pure kernel from the given
 * state/config/deps, runs its init, and boots navigation interception + the
 * initial scan. No-op without a DOM.
 *
 * @param state - The plugin state to drive the kernel.
 * @param config - The spa config.
 * @param deps - Resolved router + head APIs.
 * @param emit - Optional event emitter to forward spa lifecycle events to.
 * @example
 * boot(state, config, { router, head });
 */
export function boot(
  state: SpaState,
  config: SpaConfig,
  deps: SpaKernelDeps,
  emit: SpaEmitFunction = noopEmit
): void {
  const kernel = createSpaKernel(state, config, emit, deps);
  state.kernel = kernel;
  kernel.init();
  kernel.boot();
}

/**
 * Live client-runtime navigation to a path (no-op without a DOM or before boot).
 *
 * @param state - The plugin state holding the booted kernel.
 * @param path - Target path to navigate to.
 * @example
 * navigate(state, "/about");
 */
export function navigate(state: SpaState, path: string): void {
  state.kernel?.processNav(path);
}
