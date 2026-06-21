/**
 * @file `@moku-labs/web/testing` — a tiny headless test harness for SPA islands.
 *
 * Mounts ONE island through the REAL spa kernel internals (`createState` +
 * `scanAndMount` + `notifyNav*` + `unmountPageSpecific`/`unmountAll`) under a DOM
 * (happy-dom in Vitest), so a consumer can unit-test an island in a few lines without
 * reaching into framework internals or booting a whole `createApp`. It drives the
 * plugin-mirror API directly: read typed `state`/`api`, dispatch declarative `events`,
 * drain the `ctx.set → render` scheduler (`flush`/`settle`), simulate navigation, and
 * assert auto-teardown of `events` + `ctx.cleanup` on `unmount`.
 *
 * This module is a SEPARATE entry — NEVER imported by `browser.ts` — so test-only code
 * (and its static Preact import for {@link renderIsland}) never enters a client bundle.
 * @see README.md
 */

import { render as preactRender } from "preact";
import { act } from "preact/test-utils";
import {
  notifyNavEnd,
  notifyNavStart,
  type RouteSlice,
  scanAndMount,
  unmountAll,
  unmountPageSpecific
} from "./plugins/spa/components";
import { createState } from "./plugins/spa/state";
import type {
  ComponentContext,
  // eslint-disable-next-line unicorn/prevent-abbreviations -- canonical public type name per spec
  ComponentDef,
  ComponentRender,
  PageData,
  RenderResult
} from "./plugins/spa/types";

/** The swap selector the harness uses to bound page-specific islands. */
const SWAP_SELECTOR = "main > section";

/** One captured spa emit (the kernel's `spa:component-mount` / `-unmount`). */
export interface CapturedEmit {
  /** The event name. */
  readonly event: string;
  /** The event payload. */
  readonly payload: unknown;
}

/** A mounted island a unit/integration test drives without booting `createApp`. */
export interface IslandHandle<S extends object = object, A = unknown> {
  /** The host element the island bound to (already in `document.body`). */
  readonly el: HTMLElement;
  /** Live per-instance state (typed). `undefined` for legacy hooks-only islands. */
  readonly state: S | undefined;
  /** The island's registered api (typed), if it declared `api`. */
  readonly api: A | undefined;
  /**
   * Dispatch a delegated event by spec: `fire("click [data-action='delete']")` clicks
   * the first matching element inside the host (or the host itself when no selector).
   *
   * @param spec - `"<type>"` or `"<type> <selector>"` (same grammar as the `events` map).
   * @param init - Optional event init (bubbles/cancelable are defaulted true).
   * @example
   * handle.fire("submit [data-create]");
   */
  fire(spec: string, init?: EventInit): void;
  /**
   * Dispatch a RAW, pre-built event at a selector — full control for events the
   * synthetic `fire` cannot build (DragEvent/dataTransfer/clientY).
   *
   * @param selector - The element to dispatch on (the host when no match).
   * @param event - The pre-constructed event.
   * @example
   * handle.dispatch('[data-cards]', Object.assign(new Event("drop", { bubbles: true }), { dataTransfer }));
   */
  dispatch(selector: string, event: Event): void;
  /**
   * Synchronously drain any pending render now (mutate → flush → assert, no `await`).
   * For VNode-returning islands call {@link IslandHandle.settle} first so the lazy
   * Preact render chunk is loaded.
   *
   * @example
   * handle.flush();
   */
  flush(): void;
  /**
   * Await `onMount`'s returned promise + the render-chunk load + a microtask, then
   * flush — the deterministic settle for async mounts and VNode renders.
   *
   * @returns A promise resolving once the island is fully mounted and rendered.
   * @example
   * await handle.settle();
   */
  settle(): Promise<void>;
  /**
   * Fire `onNavStart` on the instance (persistent + page-specific receive it).
   *
   * @example
   * handle.navStart();
   */
  navStart(): void;
  /**
   * Fire `onNavEnd` on a persistent instance, with an optional destination route slice.
   *
   * @param route - Partial route slice to merge onto the current one.
   * @example
   * handle.navEnd({ params: { id: "b2" } });
   */
  navEnd(route?: Partial<RouteSlice>): void;
  /**
   * Run `onUnMount` + `onDestroy` (asserts auto-teardown of `events` + `ctx.cleanup`).
   *
   * @example
   * handle.unmount();
   */
  unmount(): void;
  /** Captured `spa:component-mount` / `-unmount` emits, in order. */
  readonly emitted: ReadonlyArray<CapturedEmit>;
}

/** Options for {@link mountIsland}. All optional; sensible headless defaults. */
export interface MountIslandOptions {
  /** Inner HTML placed INSIDE the host before mount (the SSR markup the island enhances). */
  html?: string;
  /** Mount into THIS element instead of creating one (sandbox: a real page host). */
  el?: HTMLElement;
  /** Route params (→ `ctx.params`). */
  params?: Record<string, string>;
  /** Route meta (→ `ctx.meta`). */
  meta?: Record<string, unknown>;
  /** Page data (→ `ctx.data`; serialized into `#__DATA__` so `extractPageData` sees it). */
  data?: PageData;
  /** Route locale (→ `ctx.locale`). */
  locale?: string;
  /** Link builder (→ `ctx.url`); defaults to `/<name>`. */
  url?: (name: string, params?: Record<string, string>) => string;
  /** Mount OUTSIDE the swap area so the instance is persistent (gets `onNavEnd`). */
  persistent?: boolean;
  /** Stubbed sibling-island apis resolved by `ctx.component(name)`. */
  components?: Record<string, unknown>;
}

/**
 * Parse a `"<type> <selector>"` event spec into its event type and selector (only the
 * first space splits, so descendant-combinator selectors work).
 *
 * @param spec - The event spec string.
 * @returns The event `type` and `selector` (selector empty for host-level).
 * @example
 * parseEventSpec("click [data-action='x']"); // { type: "click", selector: "[data-action='x']" }
 */
function parseEventSpec(spec: string): { type: string; selector: string } {
  const space = spec.indexOf(" ");
  return space === -1
    ? { type: spec.trim(), selector: "" }
    : { type: spec.slice(0, space).trim(), selector: spec.slice(space + 1).trim() };
}

/**
 * Mount ONE island headlessly through the REAL spa kernel internals under a DOM. The
 * unit + light-integration tier: no `createApp`, no router, no network.
 *
 * @param definition - The component definition under test (from `createComponent`).
 * @param options - Host HTML/element, route slice, page data, persistence, stub apis.
 * @returns A handle exposing the instance's `state`/`api` + event/nav/flush drivers.
 * @example
 * const h = mountIsland(tabNav, { html: "<a></a><a></a><a></a>", persistent: true });
 * h.navEnd({ locale: "en" });
 * expect(h.el.querySelector("[aria-current]")).toBeTruthy();
 */
export function mountIsland<S extends object = object, A = unknown>(
  definition: ComponentDef,
  options: MountIslandOptions = {}
): IslandHandle<S, A> {
  // 1. Fresh isolated kernel state (mirrors the framework's own freshState()).
  const state = createState({ global: {}, config: {} });
  state.registeredComponents.set(definition.name, definition);
  if (options.components) {
    for (const [name, api] of Object.entries(options.components)) {
      state.componentApis.set(name, api);
    }
  }

  // 2. Build the DOM: a swap region + the host (created, or the provided element).
  const host = options.el ?? document.createElement("div");
  host.dataset.component = definition.name;
  if (options.html !== undefined) host.innerHTML = options.html;

  const dataScript = options.data
    ? `<script id="__DATA__" type="application/json">${JSON.stringify(options.data)}</script>`
    : "";
  document.body.innerHTML = `<main><section id="__moku_swap"></section></main>${dataScript}`;
  if (!options.el) {
    // Persistent → outside the swap area (body); page-specific → inside the swap region.
    const swapRegion = document.querySelector("#__moku_swap");
    (options.persistent ? document.body : (swapRegion ?? document.body)).append(host);
  }

  // 3. Capture emits exactly like the framework's spy emit.
  const emitted: CapturedEmit[] = [];
  // eslint-disable-next-line jsdoc/require-jsdoc -- inline spy emit capturing kernel events
  const emit = (event: string, payload: unknown): void => {
    emitted.push({ event, payload });
  };

  // 4. Mount via the real internal (route slice → ctx.params/meta/locale/url).
  const route: RouteSlice = {
    params: options.params ?? {},
    meta: options.meta ?? {},
    locale: options.locale ?? "",
    url: options.url ?? (name => `/${name}`)
  };
  scanAndMount(state, emit, SWAP_SELECTOR, route);

  const instance = state.instances.get(host);

  return {
    el: host as HTMLElement,
    /**
     * The live per-instance state (typed), or undefined for hooks-only islands.
     *
     * @returns The current state.
     * @example
     * handle.state?.count;
     */
    get state(): S | undefined {
      return instance?.state as S | undefined;
    },
    /**
     * The island's registered api (typed), or undefined when none was declared.
     *
     * @returns The api object.
     * @example
     * handle.api?.open();
     */
    get api(): A | undefined {
      return instance?.api as A | undefined;
    },
    emitted,
    /**
     * Dispatch a delegated event by `"<type> <selector>"` spec onto the first match.
     *
     * @param spec - The event spec (selector optional → host-level).
     * @param init - Optional event init (bubbles/cancelable default true).
     * @example
     * handle.fire("click [data-inc]");
     */
    fire(spec: string, init?: EventInit): void {
      const { type, selector } = parseEventSpec(spec);
      const target = selector ? (host.querySelector(selector) ?? host) : host;
      target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));
    },
    /**
     * Dispatch a pre-built event at a selector (raw control for DragEvent/dataTransfer).
     *
     * @param selector - The element to dispatch on (host when no match).
     * @param event - The pre-built event.
     * @example
     * handle.dispatch("[data-cards]", dropEvent);
     */
    dispatch(selector: string, event: Event): void {
      (host.querySelector(selector) ?? host).dispatchEvent(event);
    },
    /**
     * Synchronously drain any pending render now.
     *
     * @example
     * handle.flush();
     */
    flush(): void {
      instance?.flush();
    },
    /**
     * Await onMount + the render-chunk load + a microtask, then flush.
     *
     * @returns A promise resolving once mounted and rendered.
     * @example
     * await handle.settle();
     */
    async settle(): Promise<void> {
      await instance?.mountPromise;
      await Promise.resolve();
      instance?.flush();
    },
    /**
     * Fire onNavStart on the instance.
     *
     * @example
     * handle.navStart();
     */
    navStart(): void {
      notifyNavStart(state);
    },
    /**
     * Fire onNavEnd on a persistent instance with an optional destination route.
     *
     * @param next - Partial route slice to merge onto the current one.
     * @example
     * handle.navEnd({ params: { id: "2" } });
     */
    navEnd(next?: Partial<RouteSlice>): void {
      notifyNavEnd(state, { ...route, ...next });
    },
    /**
     * Run onUnMount + onDestroy (page-specific first, then persistent).
     *
     * @example
     * handle.unmount();
     */
    unmount(): void {
      // Page-specific first (removes them), then everything remaining (persistent).
      unmountPageSpecific(state, emit);
      unmountAll(state, emit);
    }
  };
}

/**
 * Commit a {@link RenderResult} into a host for {@link renderIsland} (the pure tier):
 * `string` → innerHTML, `Node` → replaceChildren, VNode → Preact `render` (wrapped in
 * `act` so effects flush), `void` → no-op.
 *
 * @param host - The host element to render into.
 * @param result - The render result.
 * @example
 * commit(host, h(View, { items }));
 */
function commit(host: HTMLElement, result: RenderResult): void {
  if (result === undefined) return;
  if (typeof result === "string") {
    host.innerHTML = result;
    return;
  }
  if (result instanceof Node) {
    host.replaceChildren(result);
    return;
  }
  act(() => {
    preactRender(result, host);
  });
}

/** The result of {@link renderIsland} — a host plus query/flush/teardown helpers. */
export interface RenderIslandResult {
  /** The host element the view rendered into. */
  readonly host: HTMLElement;
  /**
   * The host's current `innerHTML`.
   *
   * @returns The serialized markup.
   * @example
   * expect(result.html()).toContain("Alpha");
   */
  html(): string;
  /**
   * Query the host for the first element matching a selector.
   *
   * @param selector - A CSS selector.
   * @returns The first match, or `null`.
   * @example
   * result.find("[data-board]");
   */
  find<E extends Element = Element>(selector: string): E | null;
  /**
   * Unmount the Preact tree and remove the host from the document.
   *
   * @example
   * result.unmount();
   */
  unmount(): void;
}

/**
 * No-op stand-in for a context method the pure `renderIsland` tier never invokes.
 *
 * @example
 * const ctx = { set: noopStub };
 */
function noopStub(): void {}

/**
 * Stand-in link builder for the pure `renderIsland` tier.
 *
 * @param name - The route name.
 * @returns A `/<name>` placeholder href.
 * @example
 * stubUrl("board"); // "/board"
 */
function stubUrl(name: string): string {
  return `/${name}`;
}

/**
 * The cheapest unit tier: render a controller/view island's pure `render(state, ctx)`
 * against fixture state, with no kernel and no `mountIsland`. Uses `preact/test-utils`
 * `act` (which ships WITH Preact — no new dependency) so effects flush deterministically.
 *
 * @param render - The island's `render` function (e.g. `boardList.spec.render`).
 * @param input - Fixture inputs.
 * @param input.state - The fixture per-instance state to render.
 * @param input.ctx - Optional partial context overrides.
 * @returns A {@link RenderIslandResult} for asserting the rendered DOM.
 * @example
 * const r = renderIsland(render, { state: { boards: [{ id: "1", title: "Alpha" }] } });
 * expect(r.find("[data-board]")).toBeTruthy();
 */
export function renderIsland<S extends object>(
  render: ComponentRender<S>,
  input: { state: S; ctx?: Partial<ComponentContext<S>> }
): RenderIslandResult {
  const host = document.createElement("div");
  document.body.append(host);

  // Minimal stand-in context — overridable per field via input.ctx.
  const baseContext = {
    el: host,
    data: {} as PageData,
    params: {},
    meta: {},
    locale: "",
    url: stubUrl,
    state: input.state,
    set: noopStub,
    flush: noopStub,
    cleanup: noopStub,
    component: noopStub
  } as unknown as ComponentContext<S>;
  const ctx = { ...baseContext, ...input.ctx } as ComponentContext<S>;

  commit(host, render(input.state, ctx));

  return {
    host,
    /**
     * The host's current `innerHTML`.
     *
     * @returns The serialized markup.
     * @example
     * result.html();
     */
    html(): string {
      return host.innerHTML;
    },
    /**
     * Query the host for the first element matching a selector.
     *
     * @param selector - A CSS selector.
     * @returns The first match, or `null`.
     * @example
     * result.find("[data-board]");
     */
    find<E extends Element = Element>(selector: string): E | null {
      return host.querySelector<E>(selector);
    },
    /**
     * Unmount the Preact tree and remove the host from the document.
     *
     * @example
     * result.unmount();
     */
    unmount(): void {
      // eslint-disable-next-line unicorn/no-null -- Preact's unmount sentinel
      act(() => preactRender(null, host));
      host.remove();
    }
  };
}
