/**
 * @file spa plugin — type definitions skeleton.
 * @see README.md
 */

import type { EmitFn as EmitFunction } from "@moku-labs/core";
import type { Api as HeadApi } from "../head/types";
import type { LogApi } from "../log/types";
import type { RouterApi } from "../router/types";

/** Payload map for the events `spa` emits, used to type the kernel's `emit` closure. */
export type SpaEvents = {
  /** A navigation has been intercepted and is starting. */
  "spa:navigate": { from: string; to: string };
  /** The swap completed and the new URL is active. */
  "spa:navigated": { url: string };
  /** A component instance attached to an element. */
  "spa:component-mount": { name: string; el: Element };
  /** A component instance detached from an element. */
  "spa:component-unmount": { name: string; el: Element };
};

/** Strictly-typed emit closure for the spa events (kernel overload form). */
export type SpaEmitFunction = EmitFunction<SpaEvents>;

/**
 * Structural extraction of a plugin instance's public API from its `_phantom`
 * carrier (mirrors the kernel's non-exported `ExtractPluginApi`).
 *
 * @example
 * type RApi = ExtractApi<typeof routerPlugin>;
 */
export type ExtractApi<PluginCandidate> = PluginCandidate extends {
  readonly _phantom: { readonly api: infer PluginApi };
}
  ? PluginApi
  : never;

/** Generic `require` closure for pulling dependency plugin APIs at init time. */
export type SpaRequire = <
  PluginCandidate extends {
    readonly name: string;
    readonly spec: unknown;
    readonly _phantom: {
      readonly config: unknown;
      readonly state: unknown;
      readonly api: unknown;
      readonly events: Record<string, unknown>;
    };
  }
>(
  plugin: PluginCandidate
) => ExtractApi<PluginCandidate>;

/**
 * The plugin-context slice the spa wiring consumes in `onInit`/`onStart`:
 * mutable `state`, resolved `config`, `require`/`emit`/`log`. Structurally
 * assignable from the framework's generic execution context.
 */
export interface SpaContext {
  /** Mutable spa state (all kernel data lives here). */
  state: SpaState;
  /** Resolved, frozen spa config. */
  readonly config: Readonly<SpaConfig>;
  /** Resolve a depended-upon plugin instance to its public API. */
  require: SpaRequire;
  /** Emit a spa lifecycle event (notification-only). */
  emit: SpaEmitFunction;
  /** Structured logger (core `log` API). */
  readonly log: LogApi;
}

/** Configuration for the SPA runtime plugin. All fields optional; defaults applied in onInit. */
export type SpaConfig = {
  /**
   * CSS selector for the page region swapped on navigation. Defaults to
   * `"main > section"`.
   */
  swapSelector?: string;
  /**
   * Use the View Transitions API for cross-fade swaps when available.
   * Falls back to an instant swap when unsupported. Defaults to `false`.
   */
  viewTransitions?: boolean;
  /**
   * Show the in-house top progress bar during navigation. Defaults to `true`.
   */
  progressBar?: boolean;
  /**
   * Components to auto-register at init (in addition to runtime `register`).
   * Defaults to an empty array.
   */
  components?: ComponentDef[];
};

/** Resolved SPA config after defaults are applied. */
export interface ResolvedSpaConfig {
  /** CSS selector for the swapped page region. */
  swapSelector: string;
  /** Whether View Transitions are enabled. */
  viewTransitions: boolean;
  /** Whether the progress bar is enabled. */
  progressBar: boolean;
  /** Pre-registered components. */
  components: ComponentDef[];
}

/** Context handed to every component lifecycle hook. */
export interface ComponentContext {
  /** The element the component instance is bound to. */
  el: Element;
  /** Page data extracted from the `script#__DATA__` payload. */
  data: PageData;
}

/** Lifecycle hooks a component may implement. */
export interface ComponentHooks {
  /**
   * Called once when the instance is created (before DOM attach).
   *
   * @param ctx - The component context for this instance.
   * @returns void
   * @example
   * onCreate({ el }) { el.dataset.ready = "1"; }
   */
  onCreate?(ctx: ComponentContext): void;
  /**
   * Called after the instance is attached to its element.
   *
   * @param ctx - The component context for this instance.
   * @returns void
   * @example
   * onMount({ el }) { el.textContent = "0"; }
   */
  onMount?(ctx: ComponentContext): void;
  /**
   * Called when a navigation begins while this instance is mounted.
   *
   * @param ctx - The component context for this instance.
   * @returns void
   * @example
   * onNavStart({ el }) { el.dataset.loading = ""; }
   */
  onNavStart?(ctx: ComponentContext): void;
  /**
   * Called when a navigation completes while this instance is mounted.
   *
   * @param ctx - The component context for this instance.
   * @returns void
   * @example
   * onNavEnd({ el }) { delete el.dataset.loading; }
   */
  onNavEnd?(ctx: ComponentContext): void;
  /**
   * Called before the instance is detached from its element.
   *
   * @param ctx - The component context for this instance.
   * @returns void
   * @example
   * onUnMount({ el }) { el.replaceChildren(); }
   */
  onUnMount?(ctx: ComponentContext): void;
  /**
   * Called once when the instance is destroyed (after detach).
   *
   * @param ctx - The component context for this instance.
   * @returns void
   * @example
   * onDestroy({ el }) { delete el.dataset.ready; }
   */
  onDestroy?(ctx: ComponentContext): void;
}

/** Allowed hook names — single source of truth for fail-fast validation. */
export const COMPONENT_HOOK_NAMES = [
  "onCreate",
  "onMount",
  "onNavStart",
  "onNavEnd",
  "onUnMount",
  "onDestroy"
] as const;

/** A registered component definition. */
// eslint-disable-next-line unicorn/prevent-abbreviations -- `ComponentDef` is the canonical public type name per spec
export interface ComponentDef {
  /** Unique component name (matched against `data-component`). */
  name: string;
  /** Lifecycle hooks. */
  hooks: ComponentHooks;
}

/** A live, mounted component instance. */
export interface ComponentInstance {
  /** The definition this instance was created from. */
  def: ComponentDef;
  /** The element this instance is bound to. */
  el: Element;
  /**
   * True if the element is OUTSIDE the swap area — persists across navigations
   * and receives onNavStart/onNavEnd (never onUnMount on nav). False =
   * page-specific: full unmount/destroy on every navigation.
   */
  persistent: boolean;
}

/** Page data payload parsed from the inline `script#__DATA__` element. */
export type PageData = Record<string, unknown>;

/** Resolved dependency APIs the kernel reuses (router match/manifest, head compose). */
export interface SpaKernelDeps {
  /** Router plugin API — used for client-side route classification/matching. */
  router: RouterApi;
  /**
   * Head plugin API — its pure compose is reused for client head-sync. Optional:
   * the client reuses the server-rendered `<head>` from each fetched document, so
   * the browser entry (`@moku-labs/web/client`) can omit it. The framework plugin
   * path always provides it.
   */
  head?: HeadApi;
}

/** The single shared SPA kernel — pure factory over state/config/emit/deps. */
export interface SpaKernel {
  /**
   * Validate config, register config.components, seed currentUrl.
   *
   * @returns void
   * @example
   * kernel.init();
   */
  init(): void;
  /**
   * Boot the browser runtime (router listeners + initial scan). Throws if started.
   *
   * @returns void
   * @example
   * kernel.boot();
   */
  boot(): void;
  /**
   * Register a component definition (last-registered-wins).
   *
   * @param component - The component definition to register.
   * @returns void
   * @example
   * kernel.register(counter);
   */
  register(component: ComponentDef): void;
  /**
   * Process a navigation to `path`: fetch then swap then head-sync then emit.
   *
   * @param path - The target path to navigate to.
   * @returns void
   * @example
   * kernel.processNav("/about");
   */
  processNav(path: string): void;
  /**
   * Query the swap region and mount components for matching elements.
   *
   * @returns void
   * @example
   * kernel.scan();
   */
  scan(): void;
  /**
   * Tear down router listeners, run unmount/destroy, clear instances.
   *
   * @returns void
   * @example
   * kernel.dispose();
   */
  dispose(): void;
}

/** Internal mutable state for the spa plugin (all kernel data lives here). */
export interface SpaState {
  /** Components registered by name (last-registered-wins). */
  registeredComponents: Map<string, ComponentDef>;
  /** Live component instances keyed by their bound element. */
  instances: Map<Element, ComponentInstance>;
  /** The current resolved URL (pathname + search). */
  currentUrl: string;
  /** Teardown handle for the attached router listeners (null when detached). */
  destroyRouter: (() => void) | null;
  /** Whether the browser runtime has been booted. */
  started: boolean;
  /** The single shared SPA kernel instance (null until onInit builds it). */
  kernel: SpaKernel | null;
}

/** Public API of the spa plugin (registration / control surface). */
export type SpaApi = {
  /**
   * Register a component definition for client mounting.
   *
   * @param component - The component definition created via `createComponent`.
   * @returns void
   * @example
   * app.spa.register(counter);
   */
  register(component: ComponentDef): void;
  /**
   * Programmatically navigate to a path (client runtime; no-op without a DOM).
   *
   * @param path - Target path (pathname, optionally with search/hash).
   * @returns void
   * @example
   * app.spa.navigate("/about");
   */
  navigate(path: string): void;
  /**
   * Read the current resolved URL.
   *
   * @returns The current pathname + search.
   * @example
   * const url = app.spa.current(); // "/about"
   */
  current(): string;
};
