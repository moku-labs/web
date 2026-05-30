/**
 * spa plugin — browser client entry. Imports ONLY pure domain fns, never ctx or
 * any Moku kernel code (keeps the browser bundle server-free). Exposed as the
 * `./spa` framework subpath export.
 *
 * @file spa plugin — browser client entry.
 * @see README.md
 */
import type { SpaConfig, SpaKernelDeps, SpaState } from "./types";

/**
 * Boots the SPA runtime in the browser: builds the pure kernel from the given
 * state/config/deps and attaches navigation interception + initial scan.
 *
 * @param _state - The plugin state to drive the kernel.
 * @param _config - The spa config.
 * @param _deps - Resolved router + head APIs.
 * @example
 * boot(state, config, { router, head });
 */
export function boot(_state: SpaState, _config: SpaConfig, _deps: SpaKernelDeps): void {
  throw new Error("not implemented");
}

/**
 * Live client-runtime navigation to a path (no-op without a DOM).
 *
 * @param _state - The plugin state holding the booted kernel.
 * @param _path - Target path to navigate to.
 * @example
 * navigate(state, "/about");
 */
export function navigate(_state: SpaState, _path: string): void {
  throw new Error("not implemented");
}
