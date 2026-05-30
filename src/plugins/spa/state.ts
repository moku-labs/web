/**
 * @file spa plugin — state + config-defaults factory skeleton.
 * @see README.md
 */
// eslint-disable-next-line unicorn/prevent-abbreviations -- `ComponentDef` is the canonical public type name per spec
import type { ComponentDef, ComponentInstance, SpaConfig, SpaState } from "./types";

/** Default SPA config (declared as a value — no inline assertion). */
export const defaultSpaConfig: SpaConfig = {
  swapSelector: "main > section",
  viewTransitions: false,
  progressBar: true,
  components: []
};

/**
 * Creates initial spa plugin state. All kernel state lives here — never module
 * scope. The kernel itself is built in onInit and stored as `kernel`, so
 * api/onStart/onStop all reuse the single shared instance.
 *
 * @param _ctx - Minimal context with global and config.
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns The initial SPA state with an empty kernel slot.
 * @example
 * const state = createState({ global: {}, config: defaultSpaConfig });
 */
export function createState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<SpaConfig>;
}): SpaState {
  return {
    registeredComponents: new Map<string, ComponentDef>(),
    instances: new Map<Element, ComponentInstance>(),
    currentUrl: "",
    // eslint-disable-next-line unicorn/no-null -- `destroyRouter` is `(() => void) | null` until the router attaches
    destroyRouter: null,
    started: false,
    // eslint-disable-next-line unicorn/no-null -- `kernel` is `SpaKernel | null` until onInit builds it
    kernel: null
  };
}
