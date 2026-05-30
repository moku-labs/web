/**
 * @file spa plugin — state + config-defaults factory skeleton.
 * @see README.md
 */

import type {
  // eslint-disable-next-line unicorn/prevent-abbreviations -- canonical public type name per spec
  ComponentDef,
  ComponentInstance,
  ResolvedSpaConfig,
  SpaConfig,
  SpaState
} from "./types";

/** Error prefix for spa config-validation failures (spec/11 Part-3). */
const ERROR_PREFIX = "[web]";

/** Default SPA config (declared as a value — no inline assertion). */
export const defaultSpaConfig: SpaConfig = {
  swapSelector: "main > section",
  viewTransitions: false,
  progressBar: true,
  components: []
};

/**
 * Whether a selector is syntactically valid (parseable by the DOM). Falls back
 * to a permissive `true` in headless contexts without `document`.
 *
 * @param selector - The CSS selector to validate.
 * @returns True when the selector parses (or no DOM is available to check).
 * @example
 * isValidSelector("main > section"); // true
 */
function isValidSelector(selector: string): boolean {
  if (typeof document === "undefined") return true;
  try {
    document.querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates the spa config and applies defaults (Part-3 errors on an empty or
 * syntactically-invalid `swapSelector`). Component-hook validation runs later in
 * `createComponent` when the components are registered.
 *
 * @param config - The raw spa config to validate.
 * @returns The fully-resolved config with defaults applied.
 * @throws {Error} When `swapSelector` is empty or not a valid CSS selector.
 * @example
 * const resolved = resolveSpaConfig({ swapSelector: "main > section" });
 */
export function resolveSpaConfig(config: SpaConfig): ResolvedSpaConfig {
  const swapSelector = config.swapSelector ?? defaultSpaConfig.swapSelector ?? "main > section";
  if (swapSelector.trim() === "") {
    throw new Error(
      `${ERROR_PREFIX} spa.swapSelector must be a non-empty string\n  → set a CSS selector for the page region to swap (e.g. "main > section")`
    );
  }
  if (!isValidSelector(swapSelector)) {
    throw new Error(
      `${ERROR_PREFIX} spa.swapSelector is not a valid CSS selector: "${swapSelector}"\n  → provide a syntactically valid selector`
    );
  }
  return {
    swapSelector,
    viewTransitions: config.viewTransitions ?? false,
    progressBar: config.progressBar ?? true,
    components: config.components ?? []
  };
}

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
