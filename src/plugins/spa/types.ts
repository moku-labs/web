/**
 * @file spa plugin — type definitions skeleton.
 * @see README.md
 */

import type { Log } from "@moku-labs/common";
import type { EmitFn as EmitFunction } from "@moku-labs/core";
import type { Api as HeadApi } from "../head/types";
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
  /**
   * Whether a plugin is registered (by name). Used to detect the OPTIONAL `data`
   * plugin at init — `spa` enables client DATA navigation only when `has("data")`.
   */
  has: (name: string) => boolean;
  /** Emit a spa lifecycle event (notification-only). */
  emit: SpaEmitFunction;
  /** Structured logger (core `log` API). */
  readonly log: Log.LogApi;
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

/**
 * What a component's `render` may return:
 * - a Preact `VNode` — committed into the host through the lazy Preact gate (`commitVNode`);
 * - a `Node` — replaces the host's children;
 * - a `string` — set as the host's `innerHTML`;
 * - `void`/`undefined` — the render mutated the DOM itself (DOM-only islands → no Preact loaded).
 */
// biome-ignore lint/suspicious/noConfusingVoidType: a render may legitimately return nothing (DOM-only islands)
export type RenderResult = import("preact").VNode | Node | string | void;

/**
 * Factory that builds a component's typed per-instance state (mirrors a plugin's
 * `createState`). Called ONCE at mount; the returned object is stored on the
 * {@link ComponentInstance} and exposed read-only as `ctx.state`.
 *
 * @param ctx - The component context for this instance (state is not yet set).
 * @returns The initial per-instance state.
 * @example
 * state: (ctx): BoardState => ({ boardId: ctx.params.id ?? "", cards: [] })
 */
export type ComponentStateFactory<S extends object> = (ctx: ComponentContext<S>) => S;

/**
 * Pure render of `(state, ctx)` → {@link RenderResult}. Called after mount-state-init
 * and again (microtask-batched) after every `ctx.set`. Must be free of side effects
 * beyond producing its result.
 *
 * @param state - The current per-instance state (read-only).
 * @param ctx - The component context for this instance.
 * @returns The render result to commit into the host.
 * @example
 * render: (state) => h(BoardView, { snapshot: state.snapshot })
 */
export type ComponentRender<S extends object> = (
  state: Readonly<S>,
  ctx: ComponentContext<S>
) => RenderResult;

/**
 * A delegated DOM event handler. `target` is the element matched by the key's selector
 * (already resolved via `closest` — no `instanceof`/`closest` ceremony in the body).
 *
 * Typed `void` for ergonomics (the void-return rule accepts async handlers returning
 * `Promise<void>` too); the kernel ignores any returned value.
 *
 * @param ctx - The component context (carries the live per-instance `state`).
 * @param event - The raw DOM event.
 * @param target - The element matched by the selector (the host when no selector).
 * @returns void (a returned promise is ignored by the kernel).
 * @example
 * (ctx, event, button) => { event.preventDefault(); ctx.set({ open: true }); }
 */
export type ComponentEventHandler<S extends object> = (
  ctx: ComponentContext<S>,
  event: Event,
  target: Element
) => void;

/**
 * Declarative delegated event map. Each key is `"<type> <selector>"` (the selector is
 * optional → a host-level listener). ONE real listener per event TYPE is attached to
 * the host; dispatch walks `event.target.closest(selector)` within the host. All
 * listeners are auto-removed on destroy.
 *
 * @example
 * events: {
 *   "click [data-action='delete']": (ctx, _e, btn) => ctx.set(removeCard(ctx.state, btn)),
 *   "submit [data-add]": (ctx, e) => { e.preventDefault(); add(ctx); }
 * }
 */
export type ComponentEvents<S extends object> = Record<string, ComponentEventHandler<S>>;

/**
 * Context handed to every component lifecycle hook, render, and event handler — the
 * bound element + page data, plus the matched route's `params`/`meta`/`locale` and a
 * link builder, so an island can read its route context (e.g. a `card` route's
 * `ctx.meta.focus` + `ctx.params.id`) directly, without the page bridging it through
 * `data-*` attributes.
 *
 * Generic over the per-instance state `S` (default `undefined` so every existing
 * hooks-only island still type-checks). The additive members (`state`/`set`/`flush`/
 * `cleanup`/`component`) are ALWAYS-PRESENT functions — never optional keys — so they
 * never trip `exactOptionalPropertyTypes`.
 */
export interface ComponentContext<S = undefined> {
  /** The element the component instance is bound to. */
  el: Element;
  /** Page data extracted from the `script#__DATA__` payload. */
  data: PageData;
  /** Resolved path params of the route matched for the current URL (empty if unmatched). */
  readonly params: Record<string, string | undefined>;
  /** The matched route's `.meta()` bag (empty if unmatched). */
  readonly meta: Record<string, unknown>;
  /** Active locale for the current route (empty string if unknown). */
  readonly locale: string;
  /** Build a link to a named route by pattern substitution (same output as `app.router.toUrl`). */
  readonly url: (name: string, params?: Record<string, string>) => string;
  /** The live per-instance state (the object returned by `spec.state`). `undefined` for legacy hooks-only islands. */
  readonly state: S;
  /**
   * Merge a patch into the per-instance state, then schedule ONE batched render.
   * Accepts a partial object or an updater `(prev) => partial`. A no-op for legacy
   * islands with no `state`/`render`.
   *
   * @param patch - A partial state object, or an updater returning one.
   * @returns void
   * @example
   * ctx.set({ open: true });
   * ctx.set(prev => ({ count: prev.count + 1 }));
   */
  set(patch: Partial<S> | ((prev: Readonly<S>) => Partial<S>)): void;
  /**
   * Force a synchronous render now (drains any pending scheduled render). Rarely
   * needed in app code — `ctx.set` already schedules one; mainly a test seam.
   *
   * @returns void
   * @example
   * ctx.flush();
   */
  flush(): void;
  /**
   * Register a disposer run on `onDestroy` (subscriptions, timers, manual/global
   * listeners the declarative `events` map cannot cover). Disposers run LIFO.
   *
   * @param dispose - The teardown function.
   * @returns void
   * @example
   * ctx.cleanup(onPatch(p => applyPatch(ctx, p)));
   */
  cleanup(dispose: () => void): void;
  /**
   * Resolve another island's registered `api` by name. Returns `undefined` when no
   * provider is registered (optional-dependency semantics, mirroring `ctx.has`).
   *
   * @param name - The provider island's component name.
   * @returns The provider's api, or `undefined`.
   * @example
   * ctx.component<LightboxApi>("lightbox")?.open(slides, index);
   */
  component<T = unknown>(name: string): T | undefined;
}

/** Lifecycle hooks a component may implement. Generic over the per-instance state `S`. */
export interface ComponentHooks<S = undefined> {
  /**
   * Called once when the instance is created (before DOM attach).
   *
   * @param ctx - The component context for this instance.
   * @returns void
   * @example
   * onCreate({ el }) { el.dataset.ready = "1"; }
   */
  onCreate?(ctx: ComponentContext<S>): void;
  /**
   * Called after the instance is attached to its element.
   *
   * @param ctx - The component context for this instance.
   * @returns void
   * @example
   * onMount({ el }) { el.textContent = "0"; }
   * @example
   * async onMount(ctx) { ctx.set({ items: await load() }); } // async is allowed; the harness awaits it via settle()
   */
  onMount?(ctx: ComponentContext<S>): void;
  /**
   * Called when a navigation begins while this instance is mounted.
   *
   * @param ctx - The component context for this instance.
   * @returns void
   * @example
   * onNavStart({ el }) { el.dataset.loading = ""; }
   */
  onNavStart?(ctx: ComponentContext<S>): void;
  /**
   * Called when a navigation completes while this instance is mounted.
   *
   * @param ctx - The component context for this instance.
   * @returns void
   * @example
   * onNavEnd({ el }) { delete el.dataset.loading; }
   */
  onNavEnd?(ctx: ComponentContext<S>): void;
  /**
   * Called before the instance is detached from its element.
   *
   * @param ctx - The component context for this instance.
   * @returns void
   * @example
   * onUnMount({ el }) { el.replaceChildren(); }
   */
  onUnMount?(ctx: ComponentContext<S>): void;
  /**
   * Called once when the instance is destroyed (after detach).
   *
   * @param ctx - The component context for this instance.
   * @returns void
   * @example
   * onDestroy({ el }) { delete el.dataset.ready; }
   */
  onDestroy?(ctx: ComponentContext<S>): void;
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

/**
 * The plugin-mirror authoring form for {@link createComponent}: typed per-instance
 * `state`, `render`, declarative `events`, and a cross-island `api` on top of the
 * lifecycle hooks. All keys optional + additive; the presence of any spec-only key
 * (`state`/`render`/`events`/`api`) selects the spec overload of `createComponent`.
 *
 * @example
 * createComponent<{ boards: Board[] }>("board-list", {
 *   state: () => ({ boards: [] }),
 *   async onMount(ctx) { ctx.set({ boards: await ctx.component<Api>("api")!.list() }); },
 *   render: (s) => h(BoardList, { boards: s.boards }),
 *   events: { "submit [data-create]": (ctx, e) => { e.preventDefault(); create(ctx); } }
 * });
 */
export interface ComponentSpec<S extends object = object, A = unknown> extends ComponentHooks<S> {
  /** Build typed per-instance state at mount (stored on the instance, not a module WeakMap). */
  state?: ComponentStateFactory<S>;
  /** Pure render re-invoked (microtask-batched) on every `ctx.set`. */
  render?: ComponentRender<S>;
  /** Declarative delegated DOM events with auto-teardown. */
  events?: ComponentEvents<S>;
  /** Public api factory — registered under the component name; reached via `app.spa.component(name)`. */
  api?: (ctx: ComponentContext<S>) => A;
}

/**
 * The spec extras carried on a {@link ComponentDef}, type-erased to `object` state
 * (authors keep full `S` inference at the `createComponent` call site; the registry
 * stores the runtime-only erased form). Absent for legacy `(name, hooks)` defs.
 */
export interface ComponentSpecExtras {
  /** Per-instance state factory. */
  state?: ComponentStateFactory<object>;
  /** Render called on mount + after every `ctx.set`. */
  render?: ComponentRender<object>;
  /** Declarative delegated events. */
  events?: ComponentEvents<object>;
  /** Public api factory registered under the component name. */
  api?: (ctx: ComponentContext<object>) => unknown;
}

/** A registered component definition (an opaque token; author inference lives on `createComponent`). */
// eslint-disable-next-line unicorn/prevent-abbreviations -- `ComponentDef` is the canonical public type name per spec
export interface ComponentDef {
  /** Unique component name (matched against `data-component`). */
  name: string;
  /** Lifecycle hooks (the subset shared with the legacy form). */
  hooks: ComponentHooks<object>;
  /** Plugin-mirror extras (state/render/events/api). Absent for legacy `(name, hooks)` defs. */
  spec?: ComponentSpecExtras;
}

/** The matched-route slice carried on a live instance (params/meta/locale + link builder). */
export type ComponentRouteSlice = Pick<ComponentContext, "params" | "meta" | "locale" | "url">;

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
  /** The single per-instance context reused by every hook, event handler, and render. */
  ctx: ComponentContext<object>;
  /** Live per-instance state (the object returned by `spec.state`), or undefined for hooks-only islands. */
  state: object | undefined;
  /** This instance's public api (the object returned by `spec.api`), or undefined when none declared. */
  api: unknown;
  /** Current matched-route slice (updated on navigation; read by `ctx.params/meta/locale/url`). */
  route: ComponentRouteSlice;
  /** Current page data payload (updated on navigation; read by `ctx.data`). */
  data: PageData;
  /** Disposers from `ctx.cleanup` + the declarative `events` listeners — run LIFO on destroy. */
  cleanups: Array<() => void>;
  /** Synchronously drain a pending render (the `ctx.flush` implementation). */
  flush: () => void;
  /** True while a render is queued for the next microtask — coalesces multiple `set` calls. */
  renderScheduled: boolean;
  /** Re-entrancy depth guard for the render scheduler (a render that calls `ctx.set`). */
  renderDepth: number;
  /** onMount's returned promise (+ render-module load) — awaited by the test harness's `settle()`. */
  mountPromise: Promise<void> | undefined;
}

/** Page data payload parsed from the inline `script#__DATA__` element. */
export type PageData = Record<string, unknown>;

/**
 * The OPTIONAL `data` provider reader the kernel uses for client DATA navigation —
 * a structural slice of the `data` plugin's API (fetch the persisted JSON for a
 * page path). Captured at init via `ctx.has("data")`/`ctx.require` so `spa` never
 * imports the `data` plugin or its types.
 */
export type SpaDataReader = (path: string) => Promise<unknown | null>;

/** Resolved dependency APIs the kernel reuses (router match/mode, head compose, optional data). */
export interface SpaKernelDeps {
  /** Router plugin API — used for client-side route matching (`match`) + the resolved `mode`. */
  router: RouterApi;
  /** Head plugin API — its pure compose is reused for client head-sync. */
  head: HeadApi;
  /**
   * The OPTIONAL `data` reader. Present only when the `data` plugin is composed.
   * When present (and `router.mode() !== "ssg"`), navigation first tries the client
   * DATA path (match → `dataAt(path)` → `route.render`); otherwise
   * it always uses HTML-over-fetch.
   */
  dataAt?: SpaDataReader;
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
  /** Registered island apis by component name (the cross-island `ctx.component`/`app.spa.component` seam). */
  componentApis: Map<string, unknown>;
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
  /**
   * Resolve a registered island's api by name (the cross-island seam). Returns
   * `undefined` when no provider with that name is currently registered.
   *
   * @param name - The provider island's component name.
   * @returns The provider's api, or `undefined`.
   * @example
   * app.spa.component<LightboxApi>("lightbox")?.open(slides, 0);
   */
  component<T = unknown>(name: string): T | undefined;
};
