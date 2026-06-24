/**
 * @file spa plugin — state + config-defaults factory skeleton.
 * @see README.md
 */

import type { TransitionMode } from "../router/types";
import type {
  // eslint-disable-next-line unicorn/prevent-abbreviations -- canonical public type name per spec
  IslandDef,
  IslandInstance,
  ResolvedSpaConfig,
  SpaConfig,
  SpaState
} from "./types";

/** Error prefix for spa config-validation failures (spec/11 Part-3). */
const ERROR_PREFIX = "[web]";

/** Last-resort `swapSelector` when neither config nor defaults supply one. */
const FALLBACK_SWAP_SELECTOR = "main > section";

/**
 * Resolve the `viewTransitions` config value into the default {@link TransitionMode}:
 * `true` → `"crossfade"`, `false` → `"none"`, a named mode → itself.
 *
 * @param raw - The raw `viewTransitions` config value (boolean or named mode).
 * @returns The resolved default transition mode.
 * @example
 * resolveDefaultTransition(true); // "crossfade"
 */
function resolveDefaultTransition(raw: boolean | TransitionMode): TransitionMode {
  if (raw === true) return "crossfade";
  if (raw === false) return "none";
  return raw;
}

/** Default SPA config (declared as a value — no inline assertion). */
export const defaultSpaConfig: SpaConfig = {
  swapSelector: "main > section",
  viewTransitions: false,
  scrollRestoration: "top",
  progressBar: true,
  islands: []
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
 * syntactically-invalid `swapSelector`). Island-hook validation runs later in
 * `createIsland` when the islands are registered.
 *
 * @param config - The raw spa config to validate.
 * @returns The fully-resolved config with defaults applied.
 * @throws {Error} When `swapSelector` is empty or not a valid CSS selector.
 * @example
 * const resolved = resolveSpaConfig({ swapSelector: "main > section" });
 */
export function resolveSpaConfig(config: SpaConfig): ResolvedSpaConfig {
  // Resolve the swap target: caller wins, then plugin default, then a hard fallback.
  const swapSelector =
    config.swapSelector ?? defaultSpaConfig.swapSelector ?? FALLBACK_SWAP_SELECTOR;

  // Reject an absent/blank selector — there is no region to swap.
  const isBlankSelector = swapSelector.trim() === "";
  if (isBlankSelector) {
    throw new Error(
      `${ERROR_PREFIX} spa.swapSelector must be a non-empty string.\n  Set a CSS selector for the page region to swap (e.g. "main > section").`
    );
  }

  // Reject a selector the DOM cannot parse (skipped in headless contexts).
  const isParseableSelector = isValidSelector(swapSelector);
  if (!isParseableSelector) {
    throw new Error(
      `${ERROR_PREFIX} spa.swapSelector is not a valid CSS selector: "${swapSelector}".\n  Provide a syntactically valid selector.`
    );
  }

  // Resolve the View-Transition default. `viewTransitions` accepts a boolean (legacy:
  // true → "crossfade", false → "none") OR a named mode. The resolved form splits into an
  // `enabled` flag (false ⇒ never run a transition) + a `defaultTransition` mode applied to
  // any route that does not declare its own `.transition()`.
  const defaultTransition = resolveDefaultTransition(config.viewTransitions ?? false);

  // Fill the remaining optional fields from their per-key defaults.
  return {
    swapSelector,
    viewTransitions: defaultTransition !== "none",
    defaultTransition,
    scrollRestoration: config.scrollRestoration ?? "top",
    progressBar: config.progressBar ?? true,
    islands: config.islands ?? []
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
    registeredIslands: new Map<string, IslandDef>(),
    instances: new Map<Element, IslandInstance>(),
    islandApis: new Map<string, unknown>(),
    currentUrl: "",
    // eslint-disable-next-line unicorn/no-null -- `destroyRouter` is `(() => void) | null` until the router attaches
    destroyRouter: null,
    started: false,
    // eslint-disable-next-line unicorn/no-null -- `navigate` is bound by the kernel at init
    navigate: null,
    // eslint-disable-next-line unicorn/no-null -- `kernel` is `SpaKernel | null` until onInit builds it
    kernel: null
  };
}
