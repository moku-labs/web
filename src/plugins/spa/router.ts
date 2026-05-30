/**
 * @file spa plugin — navigation interception (Navigation API + History fallback).
 * @see README.md
 */

import type { SpaEmit } from "./kernel";
import type { SpaKernelDeps, SpaState } from "./types";

/** Teardown handle returned by the router attach step. */
export type RouterTeardown = () => void;

/**
 * Attaches navigation interception: Navigation API (primary) with a History API
 * fallback, plus scroll restoration (sessionStorage + event.scroll). On fetch
 * failure it falls back to a full browser navigation.
 *
 * @param _state - The plugin state (currentUrl + instances read back on nav).
 * @param _emit - The event emitter for spa:navigate / spa:navigated.
 * @param _deps - Resolved router/head APIs reused for matching + head-sync.
 * @example
 * const dispose = attachRouter(state, emit, deps);
 */
export function attachRouter(
  _state: SpaState,
  _emit: SpaEmit,
  _deps: SpaKernelDeps
): RouterTeardown {
  throw new Error("not implemented");
}

/**
 * Performs a single fetch then DOMParser then swap of the page region for `path`.
 *
 * @param _path - Target pathname (optionally with search/hash).
 * @param _swapSelector - CSS selector for the region to replace.
 * @param _viewTransitions - Whether to wrap the swap in startViewTransition.
 * @example
 * await swapRegion("/about", "main > section", false);
 */
export function swapRegion(
  _path: string,
  _swapSelector: string,
  _viewTransitions: boolean
): Promise<void> {
  throw new Error("not implemented");
}
