/**
 * @file spa plugin — island lifecycle, mounting, the plugin-mirror authoring
 * surface (`createIsland` with a typed `{ state, render, events, api }` spec),
 * the per-instance state + microtask-batched render scheduler, declarative
 * delegated events, and the cross-island api registry.
 * @see README.md
 */

import {
  type AnyVNode,
  ISLAND_HOOK_NAMES,
  type IslandContext,
  // eslint-disable-next-line unicorn/prevent-abbreviations -- canonical public type name per spec
  type IslandDef,
  type IslandEventHandler,
  type IslandEvents,
  type IslandHooks,
  type IslandInstance,
  type IslandRouteSlice,
  type IslandSpec,
  type IslandSpecExtras,
  type PageData,
  type RenderResult,
  type SpaEmitFunction,
  type SpaState
} from "./types";

/** Error prefix for spa fail-fast failures (spec/11 Part-3). */
const ERROR_PREFIX = "[web]";

/** The set of legal hook names, frozen for O(1) membership checks. */
const HOOK_NAME_SET: ReadonlySet<string> = new Set(ISLAND_HOOK_NAMES);

/** The spec-only keys that select the plugin-mirror form of {@link createIsland}. */
const SPEC_KEYS: ReadonlySet<string> = new Set(["state", "render", "events", "api"]);

/** Synchronous re-entrancy cap for the render scheduler (a render that calls `ctx.flush`). */
const MAX_RENDER_DEPTH = 25;

/** The matched-route slice merged onto the island context (params/meta/locale + link builder). */
export type RouteSlice = IslandRouteSlice;

/**
 * No-op link builder for the {@link EMPTY_ROUTE} slice (used when no route matched).
 *
 * @returns An empty string.
 * @example
 * const href = noUrl();
 */
function noUrl(): string {
  return "";
}

/** Empty route slice — used for mounts with no matched route (headless, tests, public `scan()`). */
const EMPTY_ROUTE: RouteSlice = { params: {}, meta: {}, locale: "", url: noUrl };

/**
 * No-op placeholder for an instance's `flush` slot until the real one is bound at mount.
 *
 * @example
 * const instance = { flush: noop };
 */
function noop(): void {}

// ─── lazy Preact-render gate ──────────────────────────────────────────────────
// The island render scheduler reaches Preact's `render` ONLY through this dynamic
// import, so an app whose islands never return a VNode never pulls Preact's `render`
// into its main bundle (the browser bundle-assertion gate).

/** Cached promise for the lazy `./render` chunk (loaded at most once per module). */
let renderChunk: Promise<typeof import("./render")> | undefined;
/** The resolved VNode committer once the chunk loads (undefined until then). */
let commitVNodeFunction: typeof import("./render").commitVNode | undefined;

/**
 * Load the lazy `./render` chunk (once) and cache its `commitVNode` for synchronous
 * use by later renders. Awaited by a island's `mountPromise` so the test harness's
 * `settle()` can deterministically flush a VNode render.
 *
 * @returns A promise that resolves once `commitVNode` is available.
 * @example
 * await loadRenderChunk();
 */
async function loadRenderChunk(): Promise<void> {
  renderChunk ??= import("./render");
  const module = await renderChunk;
  commitVNodeFunction = module.commitVNode;
}

/**
 * Commit a {@link RenderResult} into a host: `string` → `innerHTML`, `Node` →
 * `replaceChildren`, `void`/`undefined` → no-op (the render mutated the DOM itself), and
 * a Preact `VNode` → committed through the lazy gate (loading it on demand if needed).
 *
 * @param host - The island host element to render into.
 * @param result - The value returned by the island's `render`.
 * @example
 * commitResult(host, h(View, { items }));
 */
function commitResult(host: Element, result: RenderResult): void {
  // `void`/`undefined` → the render performed its own imperative DOM writes (DOM-only island).
  if (result === undefined) return;
  if (typeof result === "string") {
    host.innerHTML = result;
    return;
  }
  if (result instanceof Node) {
    host.replaceChildren(result);
    return;
  }
  // Otherwise a Preact VNode → commit via the lazy gate (load on demand if not yet cached).
  const vnode = result as AnyVNode;
  if (commitVNodeFunction) {
    commitVNodeFunction(vnode, host);
    return;
  }
  loadRenderChunk()
    .then(() => commitVNodeFunction?.(vnode, host))
    .catch(() => {});
}

/**
 * Run a island's `render(state, ctx)` and commit the result now. Guards against
 * synchronous re-entrancy (a render that calls `ctx.flush`) with a depth cap.
 *
 * @param instance - The instance to render.
 * @throws {Error} When the synchronous render depth exceeds {@link MAX_RENDER_DEPTH}.
 * @example
 * runRender(instance);
 */
function runRender(instance: IslandInstance): void {
  const render = instance.def.spec?.render;
  if (!render) return;

  if (instance.renderDepth > MAX_RENDER_DEPTH) {
    throw new Error(
      `${ERROR_PREFIX} island "${instance.def.name}" render re-entered ${MAX_RENDER_DEPTH}+ times\n  → a render must not synchronously trigger its own render (avoid ctx.flush() inside render)`
    );
  }

  instance.renderDepth += 1;
  try {
    commitResult(instance.el, render(instance.state ?? {}, instance.ctx));
  } finally {
    instance.renderDepth -= 1;
  }
}

/**
 * Schedule a microtask-batched render for an instance (no-op when it has no `render`).
 * Multiple `ctx.set` calls in the same tick coalesce into a single render.
 *
 * @param instance - The instance to schedule a render for.
 * @example
 * scheduleRender(instance);
 */
function scheduleRender(instance: IslandInstance): void {
  if (!instance.def.spec?.render || instance.renderScheduled) return;
  instance.renderScheduled = true;
  queueMicrotask(() => {
    // A synchronous `ctx.flush()` may have already drained it — only render if still pending.
    if (!instance.renderScheduled) return;
    instance.renderScheduled = false;
    runRender(instance);
  });
}

/**
 * Build the single per-instance {@link IslandContext} reused by every hook, event
 * handler, and render. Route fields (`params`/`meta`/`locale`/`url`) and `data` read
 * through the instance so a navigation update is reflected without rebuilding the ctx;
 * `state`/`set`/`flush`/`cleanup`/`island` are bound to the instance + plugin state.
 *
 * @param state - The plugin state (for the cross-island `island` resolver).
 * @param instance - The instance the context is bound to.
 * @returns The instance-bound context.
 * @example
 * instance.ctx = buildContext(state, instance);
 */
function buildContext(state: SpaState, instance: IslandInstance): IslandContext<object> {
  return {
    el: instance.el,
    /**
     * The current page data payload (live; updated across navigations).
     *
     * @returns The page data.
     * @example
     * ctx.data;
     */
    get data(): PageData {
      return instance.data;
    },
    /**
     * The matched route's path params (live; updated across navigations).
     *
     * @returns The route params.
     * @example
     * ctx.params.id;
     */
    get params(): Record<string, string | undefined> {
      return instance.route.params;
    },
    /**
     * The matched route's `.meta()` bag (live; updated across navigations).
     *
     * @returns The route meta.
     * @example
     * ctx.meta.focus;
     */
    get meta(): Record<string, unknown> {
      return instance.route.meta;
    },
    /**
     * The active locale for the current route (live; updated across navigations).
     *
     * @returns The locale code.
     * @example
     * ctx.locale;
     */
    get locale(): string {
      return instance.route.locale;
    },
    /**
     * The named-route link builder for the current route.
     *
     * @returns The link builder.
     * @example
     * ctx.url("board", { id });
     */
    get url(): (name: string, params?: Record<string, string>) => string {
      return instance.route.url;
    },
    /**
     * The live per-instance state (`undefined` for legacy hooks-only islands).
     *
     * @returns The current state.
     * @example
     * ctx.state.count;
     */
    get state(): object {
      return instance.state as object;
    },
    /**
     * Merge a patch into the per-instance state and schedule one batched render.
     *
     * @param patch - A partial state object, or an updater `(prev) => partial`.
     * @example
     * ctx.set(prev => ({ count: prev.count + 1 }));
     */
    set(patch: Partial<object> | ((prev: Readonly<object>) => Partial<object>)): void {
      const previous = (instance.state ?? {}) as object;
      const next = typeof patch === "function" ? patch(previous) : patch;
      instance.state = Object.assign({}, previous, next);
      scheduleRender(instance);
    },
    /**
     * Force a synchronous render now (drains any pending scheduled render).
     *
     * @example
     * ctx.flush();
     */
    flush(): void {
      instance.flush();
    },
    /**
     * Register a disposer run on destroy (subscriptions, timers, manual listeners).
     *
     * @param dispose - The teardown function.
     * @example
     * ctx.cleanup(off);
     */
    cleanup(dispose: () => void): void {
      instance.cleanups.push(dispose);
    },
    /**
     * Resolve another island's registered api by name (`undefined` when absent).
     *
     * @param name - The provider island's island name.
     * @returns The provider's api, or `undefined`.
     * @example
     * ctx.island("lightbox");
     */
    island<T = unknown>(name: string): T | undefined {
      return state.islandApis.get(name) as T | undefined;
    }
  };
}

/**
 * Resolve the element a delegated handler should receive for an event: the host for a
 * host-level binding (empty selector), else the nearest ancestor of `event.target`
 * matching the selector that is still inside the host.
 *
 * @param host - The island host element.
 * @param event - The dispatched DOM event.
 * @param selector - The key's selector (empty string → host-level).
 * @returns The matched element, or `undefined` when nothing matches inside the host.
 * @example
 * const target = matchTarget(host, event, "[data-action]");
 */
function matchTarget(host: Element, event: Event, selector: string): Element | undefined {
  if (selector === "") return host;
  const target = event.target;
  if (!(target instanceof Element)) return undefined;
  const matched = target.closest(selector);
  return matched && host.contains(matched) ? matched : undefined;
}

/**
 * Attach a island's declarative `events` map: one real listener per event TYPE on
 * the host (dispatch walks `closest(selector)` for each registered selector), each
 * removed via the instance's cleanup registry on destroy.
 *
 * @param instance - The instance whose host the listeners attach to.
 * @param events - The declarative `{ "&lt;type&gt; &lt;selector&gt;": handler }` map.
 * @throws {Error} When a key has no event type.
 * @example
 * attachEvents(instance, { "click [data-action]": (ctx, e, el) => {} });
 */
function attachEvents(instance: IslandInstance, events: IslandEvents<object>): void {
  const host = instance.el;
  const byType = new Map<
    string,
    Array<{ selector: string; handler: IslandEventHandler<object> }>
  >();

  // Group handlers by event type so each type attaches exactly one delegated listener.
  for (const [key, handler] of Object.entries(events)) {
    const space = key.indexOf(" ");
    const type = (space === -1 ? key : key.slice(0, space)).trim();
    const selector = space === -1 ? "" : key.slice(space + 1).trim();
    if (type === "") {
      throw new Error(
        `${ERROR_PREFIX} island "${instance.def.name}" event key must start with an event type: "${key}"\n  → use "<type>" or "<type> <selector>" (e.g. "click [data-action]")`
      );
    }
    const list = byType.get(type) ?? [];
    list.push({ selector, handler });
    byType.set(type, list);
  }

  // Attach one delegated listener per type; register its removal on the cleanup stack.
  for (const [type, handlers] of byType) {
    // eslint-disable-next-line jsdoc/require-jsdoc -- inline delegated dispatcher for one event type
    const listener = (event: Event): void => {
      for (const { selector, handler } of handlers) {
        const target = matchTarget(host, event, selector);
        if (target) handler(instance.ctx, event, target);
      }
    };
    host.addEventListener(type, listener);
    instance.cleanups.push(() => host.removeEventListener(type, listener));
  }
}

/**
 * Validate a single hook entry: its key must be a known hook name and its value
 * must be a function. Throws fail-fast on the first violation.
 *
 * @param islandName - The owning island name (for error messages).
 * @param source - The raw authoring object being validated.
 * @param key - The hook key to validate.
 * @throws {Error} If `key` is not in `ISLAND_HOOK_NAMES`.
 * @throws {TypeError} If the hook value is not a function.
 * @example
 * validateHookEntry("counter", source, "onMount");
 */
function validateHookEntry(islandName: string, source: Record<string, unknown>, key: string): void {
  // Reject typo'd / unknown hook names so e.g. `onMout` fails immediately.
  if (!HOOK_NAME_SET.has(key)) {
    throw new Error(
      `${ERROR_PREFIX} unknown island hook "${key}" on "${islandName}"\n  → valid hooks: ${ISLAND_HOOK_NAMES.join(", ")}\n  → spec keys: state, render, events, api`
    );
  }

  // Reject non-function values for an otherwise-valid hook name.
  if (typeof source[key] !== "function") {
    throw new TypeError(
      `${ERROR_PREFIX} island hook "${key}" on "${islandName}" must be a function\n  → provide a function or omit the hook`
    );
  }
}

/**
 * Validate the spec extras (`state`/`render`/`api` must be functions; `events` must be
 * a plain object of functions). Throws fail-fast on the first violation.
 *
 * @param islandName - The owning island name (for error messages).
 * @param extras - The partitioned spec extras to validate.
 * @throws {TypeError} If a present extra has the wrong shape.
 * @example
 * validateSpecExtras("board", { state: () => ({}) });
 */
function validateSpecExtras(islandName: string, extras: IslandSpecExtras): void {
  for (const key of ["state", "render", "api"] as const) {
    if (extras[key] !== undefined && typeof extras[key] !== "function") {
      throw new TypeError(
        `${ERROR_PREFIX} island "${key}" on "${islandName}" must be a function\n  → provide a function or omit it`
      );
    }
  }
  if (extras.events !== undefined) {
    const events = extras.events as Record<string, unknown>;
    const isObject = typeof events === "object";
    if (!isObject) {
      throw new TypeError(
        `${ERROR_PREFIX} island "events" on "${islandName}" must be an object of handlers`
      );
    }
    for (const [key, handler] of Object.entries(events)) {
      if (typeof handler !== "function") {
        throw new TypeError(
          `${ERROR_PREFIX} island event "${key}" on "${islandName}" must be a function`
        );
      }
    }
  }
}

/**
 * Create a validated island definition. Accepts either the legacy hooks-only form
 * (`createIsland("counter", { onMount() {} })`) or the plugin-mirror spec form
 * (`createIsland("board", { state, render, events, api, ...hooks })`). Spec-only
 * keys (`state`/`render`/`events`/`api`) are partitioned out before hook-name
 * validation, so a real typo (e.g. `onMout`) still throws immediately while the spec
 * keys are accepted.
 *
 * @param name - Unique island name.
 * @param spec - Lifecycle hooks, or the `{ state, render, events, api, ...hooks }` spec.
 * @returns A `IslandDef` ready to `register`.
 * @throws {Error} If `name` is empty, a hook key is unknown, or an extra/hook value has the wrong shape.
 * @example
 * const counter = createIsland("counter", { onMount({ el }) { el.textContent = "0"; } });
 * @example
 * const list = createIsland<{ items: string[] }>("list", {
 *   state: () => ({ items: [] }),
 *   render: (s) => h(List, { items: s.items })
 * });
 */
export function createIsland<S extends object = object, A = unknown>(
  name: string,
  spec: IslandSpec<S, A>
): IslandDef {
  // Guard: the name must be a non-empty (post-trim) identifier.
  if (name.trim() === "") {
    throw new Error(
      `${ERROR_PREFIX} island name must be a non-empty string\n  → pass a unique name to createIsland("name", hooks)`
    );
  }

  // Partition spec-only keys from lifecycle hooks; validate each as it is classified.
  const source = spec as Record<string, unknown>;
  const hooks: Record<string, unknown> = {};
  const extras: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (SPEC_KEYS.has(key)) {
      extras[key] = source[key];
      continue;
    }
    validateHookEntry(name, source, key);
    hooks[key] = source[key];
  }
  validateSpecExtras(name, extras as IslandSpecExtras);

  const hasExtras = Object.keys(extras).length > 0;
  // The legacy and spec forms both produce the opaque IslandDef token (author
  // inference lives on the overload signatures; the registry stores the erased form).
  return hasExtras
    ? { name, hooks: hooks as IslandHooks<object>, spec: extras as IslandSpecExtras }
    : { name, hooks: hooks as IslandHooks<object> };
}

/**
 * Extracts the page data payload from the inline `script#__DATA__` element.
 * Returns an empty object when the script is absent, empty, or invalid JSON.
 *
 * @param doc - The document to read the data script from.
 * @returns The parsed page data, or `{}` when unavailable.
 * @example
 * const data = extractPageData(document);
 */
export function extractPageData(doc: Document): PageData {
  const text = doc.querySelector("script#__DATA__")?.textContent;
  if (!text) return {};
  try {
    return JSON.parse(text) as PageData;
  } catch {
    return {};
  }
}

/**
 * Read the current page data, or `{}` in a headless (non-browser) context.
 *
 * @returns The current page data payload.
 * @example
 * const data = currentPageData();
 */
function currentPageData(): PageData {
  return typeof document === "undefined" ? {} : extractPageData(document);
}

/**
 * Invokes a single lifecycle hook on an instance with its bound context. Missing
 * hooks are skipped silently.
 *
 * @param instance - The instance whose hook to run.
 * @param hook - The hook name to invoke.
 * @example
 * runHook(instance, "onDestroy");
 */
function runHook(instance: IslandInstance, hook: keyof IslandHooks<object>): void {
  instance.def.hooks[hook]?.(instance.ctx);
}

/**
 * Run an instance's registered cleanup disposers (LIFO) and unregister its api. Each
 * disposer runs in isolation so a throwing one never strands the others during teardown.
 *
 * @param state - The plugin state (for the api registry).
 * @param instance - The instance being disposed.
 * @example
 * disposeInstance(state, instance);
 */
function disposeInstance(state: SpaState, instance: IslandInstance): void {
  for (let index = instance.cleanups.length - 1; index >= 0; index -= 1) {
    try {
      instance.cleanups[index]?.();
    } catch {
      // Teardown is best-effort: a failing disposer must not strand the rest.
    }
  }
  instance.cleanups.length = 0;
  instance.renderScheduled = false;

  // Drop this instance's api from the registry only if it still owns the entry.
  if (instance.api !== undefined && state.islandApis.get(instance.def.name) === instance.api) {
    state.islandApis.delete(instance.def.name);
  }
}

/**
 * Mounts a single `data-island` element: classifies persistent vs page-specific,
 * builds the instance + its bound context, initializes per-instance `state`, registers
 * its `api`, attaches declarative `events`, fires `onCreate` then `onMount` (capturing
 * an async `onMount` + render-chunk load as `mountPromise`), schedules the initial
 * render, records it, and emits `spa:island-mount`. No-ops if the element is already
 * mounted, has no island name, or names an unregistered island.
 *
 * @param state - The plugin state (registeredIslands + instances + islandApis).
 * @param emit - The event emitter for spa:island-mount.
 * @param swapArea - The swap-region element, or null when none was found.
 * @param data - The current page data payload.
 * @param element - The candidate element carrying a `data-island` attribute.
 * @param route - The matched-route slice for the current URL (params/meta/locale/url).
 * @example
 * mountElement(state, emit, swapArea, data, element, route);
 */
function mountElement(
  state: SpaState,
  emit: SpaEmitFunction,
  swapArea: Element | null,
  data: PageData,
  element: HTMLElement,
  route: RouteSlice = EMPTY_ROUTE
): void {
  // Skip elements already bound to a live instance.
  if (state.instances.has(element)) return;

  // Skip elements whose island name is missing or unregistered.
  const name = element.dataset.island;
  if (!name) return;
  const definition = state.registeredIslands.get(name);
  if (!definition) return;

  // Persistent when outside the swap area (or when there is no swap area).
  const isPersistent = swapArea ? !swapArea.contains(element) : true;
  const instance: IslandInstance = {
    def: definition,
    el: element,
    persistent: isPersistent,
    // The ctx is bound to this instance right after construction (it reads the fields below).
    ctx: undefined as unknown as IslandContext<object>,
    state: undefined,
    api: undefined,
    route,
    data,
    cleanups: [],
    flush: noop,
    renderScheduled: false,
    renderDepth: 0,
    mountPromise: undefined
  };
  instance.ctx = buildContext(state, instance);
  // eslint-disable-next-line jsdoc/require-jsdoc -- the ctx.flush implementation: drain a pending render now
  instance.flush = (): void => {
    instance.renderScheduled = false;
    runRender(instance);
  };

  const spec = definition.spec;

  // 1. Initialize per-instance state (before hooks/render so they observe it).
  if (spec?.state) instance.state = spec.state(instance.ctx);
  // 2. Register the island's api under its name (cross-island seam; last-registered-wins).
  if (spec?.api) {
    instance.api = spec.api(instance.ctx);
    state.islandApis.set(definition.name, instance.api);
  }
  // 3. Attach declarative delegated events (auto-removed on destroy via the cleanup stack).
  if (spec?.events) attachEvents(instance, spec.events);

  // Creation hook, then mount. `onMount` may be async — capture its promise (the
  // kernel stays fire-and-forget; only the test harness awaits it via settle()).
  runHook(instance, "onCreate");
  // `onMount` is typed `void` for caller ergonomics (the void-return rule accepts async
  // functions too), but at RUNTIME it may return a Promise — capture it as `unknown`.
  const onMountResult: unknown = definition.hooks.onMount?.(instance.ctx);

  // Initial render is scheduled (microtask) so any synchronous `ctx.set` in onMount coalesces in.
  if (spec?.render) scheduleRender(instance);

  // mountPromise = render-chunk load (so settle() can flush a VNode) + an async onMount.
  const pending: Array<Promise<unknown>> = [];
  if (spec?.render) pending.push(loadRenderChunk());
  if (onMountResult && typeof (onMountResult as { then?: unknown }).then === "function") {
    pending.push(onMountResult as Promise<void>);
  }
  instance.mountPromise = pending.length > 0 ? Promise.all(pending).then(() => {}) : undefined;

  state.instances.set(element, instance);
  emit("spa:island-mount", { name: definition.name, el: element });
}

/**
 * Scans the swap region, mounts islands for matching `data-island` elements,
 * classifies persistent (outside swap area) vs page-specific (inside), runs
 * `onCreate`/`onMount` + initial render, and emits `spa:island-mount` per instance.
 * Already-mounted elements are skipped.
 *
 * @param state - The plugin state (registeredIslands + instances + islandApis).
 * @param emit - The event emitter for spa:island-mount.
 * @param swapSelector - CSS selector bounding page-specific islands.
 * @param route - The matched-route slice for the current URL (params/meta/locale/url).
 * @example
 * scanAndMount(state, emit, "main > section", route);
 */
export function scanAndMount(
  state: SpaState,
  emit: SpaEmitFunction,
  swapSelector: string,
  route: RouteSlice = EMPTY_ROUTE
): void {
  // No-op outside a DOM (SSR / non-browser environments).
  if (typeof document === "undefined") return;

  // Resolve the swap-region boundary and the page data shared by every mount.
  const swapArea = document.querySelector(swapSelector);
  const data = extractPageData(document);

  // Mount each candidate element (the helper skips already-mounted/invalid ones).
  for (const element of document.querySelectorAll<HTMLElement>("[data-island]")) {
    mountElement(state, emit, swapArea, data, element, route);
  }
}

/**
 * Unmounts page-specific instances inside the swap region (runs `onUnMount` then
 * `onDestroy`, then their cleanup disposers + api unregister), removes them from state,
 * and emits `spa:island-unmount`. Persistent instances (outside the swap area) are
 * left in place.
 *
 * @param state - The plugin state holding live instances.
 * @param emit - The event emitter for spa:island-unmount.
 * @example
 * unmountPageSpecific(state, emit);
 */
export function unmountPageSpecific(state: SpaState, emit: SpaEmitFunction): void {
  const data = currentPageData();
  for (const [element, instance] of state.instances) {
    if (instance.persistent) continue;
    instance.data = data;
    runHook(instance, "onUnMount");
    runHook(instance, "onDestroy");
    disposeInstance(state, instance);
    state.instances.delete(element);
    emit("spa:island-unmount", { name: instance.def.name, el: element });
  }
}

/**
 * Disposes ALL live instances (persistent and page-specific) on teardown: runs
 * `onUnMount` then `onDestroy`, then their cleanup disposers + api unregister, emits
 * `spa:island-unmount`, and clears the instance + api maps. Used by the kernel's
 * `dispose` on plugin stop.
 *
 * @param state - The plugin state holding live instances.
 * @param emit - The event emitter for spa:island-unmount.
 * @example
 * unmountAll(state, emit);
 */
export function unmountAll(state: SpaState, emit: SpaEmitFunction): void {
  const data = currentPageData();
  for (const [element, instance] of state.instances) {
    instance.data = data;
    runHook(instance, "onUnMount");
    runHook(instance, "onDestroy");
    disposeInstance(state, instance);
    emit("spa:island-unmount", { name: instance.def.name, el: element });
  }
  state.instances.clear();
  state.islandApis.clear();
}

/**
 * Fires `onNavStart` on every currently-mounted instance (persistent instances
 * receive it across navigations; page-specific ones receive it before unmount).
 *
 * @param state - The plugin state holding live instances.
 * @example
 * notifyNavStart(state);
 */
export function notifyNavStart(state: SpaState): void {
  const data = currentPageData();
  for (const instance of state.instances.values()) {
    instance.data = data;
    runHook(instance, "onNavStart");
  }
}

/**
 * Fires `onNavEnd` on persistent instances that survived the swap (page-specific
 * instances were already destroyed and re-created by the swap), updating their route
 * slice to the destination first.
 *
 * @param state - The plugin state holding live instances.
 * @param route - The matched-route slice for the destination URL (params/meta/locale/url).
 * @example
 * notifyNavEnd(state, route);
 */
export function notifyNavEnd(state: SpaState, route: RouteSlice = EMPTY_ROUTE): void {
  const data = currentPageData();
  for (const instance of state.instances.values()) {
    if (!instance.persistent) continue;
    instance.data = data;
    instance.route = route;
    runHook(instance, "onNavEnd");
  }
}
