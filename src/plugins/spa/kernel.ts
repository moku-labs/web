/**
 * @file spa plugin — pure SPA kernel factory (no ctx, no Moku kernel).
 * @see README.md
 */
import type {
  // eslint-disable-next-line unicorn/prevent-abbreviations -- canonical public type name per spec
  ComponentDef,
  ResolvedSpaConfig,
  SpaConfig,
  SpaKernel,
  SpaKernelDeps,
  SpaState
} from "./types";

/** Emit signature handed to the kernel (spy-able in unit tests). */
export type SpaEmit = (event: string, payload: unknown) => void;

/**
 * Module-scope holder for the active SPA kernel. `onStop` receives the minimal
 * teardown context (no `state`/`require`), so the kernel built during `onInit`
 * is parked here for disposal. Single-app-per-process by design.
 *
 * @example
 * kernelRef.current = createSpaKernel(state, config, emit, deps);
 */
export const kernelRef: { current?: SpaKernel } = {};

/**
 * Builds the single shared SPA kernel — a pure factory over state/config/emit.
 * Unit-testable with a mock state object and a spy emit; no Moku ctx involved.
 *
 * @param _state - The plugin state (all kernel data lives here).
 * @param _config - The raw spa config (defaults resolved internally on init).
 * @param _emit - The event emitter for spa lifecycle events.
 * @param _deps - Resolved router + head APIs reused by the kernel.
 * @example
 * const kernel = createSpaKernel(state, config, emit, { router, head });
 */
export function createSpaKernel(
  _state: SpaState,
  _config: SpaConfig,
  _emit: SpaEmit,
  _deps: SpaKernelDeps
): SpaKernel {
  throw new Error("not implemented");
}

/**
 * Validates the spa config and applies defaults (Part-3 errors on invalid
 * swapSelector or bad component hook names).
 *
 * @param _config - The raw spa config to validate.
 * @example
 * const resolved = resolveSpaConfig(config);
 */
export function resolveSpaConfig(_config: SpaConfig): ResolvedSpaConfig {
  throw new Error("not implemented");
}

/**
 * Registers a component definition into state (last-registered-wins).
 *
 * @param _state - The plugin state holding registeredComponents.
 * @param _component - The component definition to register.
 * @example
 * registerComponent(state, counter);
 */
export function registerComponent(_state: SpaState, _component: ComponentDef): void {
  throw new Error("not implemented");
}

/**
 * Builds the shared kernel from the plugin context, stores it on state, and runs
 * its init step. Extracted from index.ts onInit to keep wiring under budget.
 *
 * @param _ctx - The plugin context (state/config/emit/require).
 * @example
 * initSpa(ctx);
 */
export function initSpa(_ctx: unknown): void {
  throw new Error("not implemented");
}
