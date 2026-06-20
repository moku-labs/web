/**
 * @file spa plugin — component lifecycle, mounting, and createComponent helper.
 * @see README.md
 */

import type { SpaEmitFunction } from "./types";
import {
  COMPONENT_HOOK_NAMES,
  type ComponentContext,
  // eslint-disable-next-line unicorn/prevent-abbreviations -- canonical public type name per spec
  type ComponentDef,
  type ComponentHooks,
  type ComponentInstance,
  type PageData,
  type SpaState
} from "./types";

/** Error prefix for spa fail-fast failures (spec/11 Part-3). */
const ERROR_PREFIX = "[web]";

/** The set of legal hook names, frozen for O(1) membership checks. */
const HOOK_NAME_SET: ReadonlySet<string> = new Set(COMPONENT_HOOK_NAMES);

/** The matched-route slice merged onto the component context (params/meta/locale + link builder). */
export type RouteSlice = Pick<ComponentContext, "params" | "meta" | "locale" | "url">;

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
 * Validate a single hook entry: its key must be a known hook name and its value
 * must be a function. Throws fail-fast on the first violation.
 *
 * @param componentName - The owning component name (for error messages).
 * @param hooks - The hooks object being validated.
 * @param key - The hook key to validate.
 * @throws {Error} If `key` is not in `COMPONENT_HOOK_NAMES`.
 * @throws {TypeError} If the hook value is not a function.
 * @example
 * validateHookEntry("counter", hooks, "onMount");
 */
function validateHookEntry(componentName: string, hooks: ComponentHooks, key: string): void {
  // Reject typo'd / unknown hook names so e.g. `onMout` fails immediately.
  if (!HOOK_NAME_SET.has(key)) {
    throw new Error(
      `${ERROR_PREFIX} unknown component hook "${key}" on "${componentName}"\n  → valid hooks: ${COMPONENT_HOOK_NAMES.join(", ")}`
    );
  }

  // Reject non-function values for an otherwise-valid hook name.
  if (typeof (hooks as Record<string, unknown>)[key] !== "function") {
    throw new TypeError(
      `${ERROR_PREFIX} component hook "${key}" on "${componentName}" must be a function\n  → provide a function or omit the hook`
    );
  }
}

/**
 * Create a validated component definition. Validates hook names at registration
 * for fail-fast typo detection (e.g. `onMout` throws immediately) and asserts
 * each provided hook is a function.
 *
 * @param name - Unique component name.
 * @param hooks - Lifecycle hook implementations.
 * @returns A `ComponentDef` ready to `register`.
 * @throws {Error} If `name` is empty, any hook key is not in
 *   `COMPONENT_HOOK_NAMES`, or any provided hook value is not a function.
 * @example
 * const counter = createComponent("counter", {
 *   onMount({ el }) { el.textContent = "0"; }
 * });
 */
export function createComponent(name: string, hooks: ComponentHooks): ComponentDef {
  // Guard: the name must be a non-empty (post-trim) identifier.
  const hasEmptyName = name.trim() === "";
  if (hasEmptyName) {
    throw new Error(
      `${ERROR_PREFIX} component name must be a non-empty string\n  → pass a unique name to createComponent("name", hooks)`
    );
  }

  // Validate every provided hook entry (unknown key or non-function throws).
  for (const key of Object.keys(hooks)) {
    validateHookEntry(name, hooks, key);
  }

  return { name, hooks };
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
 * Builds a live component instance bound to an element.
 *
 * @param definition - The component definition.
 * @param element - The element the instance binds to.
 * @param persistent - Whether the instance survives navigation.
 * @returns The constructed (not-yet-mounted) instance.
 * @example
 * const inst = createInstance(definition, element, false);
 */
export function createInstance(
  definition: ComponentDef,
  element: Element,
  persistent: boolean
): ComponentInstance {
  return { def: definition, el: element, persistent };
}

/**
 * Invokes a single lifecycle hook on an instance with its component context.
 * Missing hooks are skipped silently.
 *
 * @param instance - The instance whose hook to run.
 * @param hook - The hook name to invoke.
 * @param ctx - The component context passed to the hook.
 * @example
 * runHook(instance, "onMount", ctx);
 */
export function runHook(
  instance: ComponentInstance,
  hook: keyof ComponentHooks,
  ctx: ComponentContext
): void {
  instance.def.hooks[hook]?.(ctx);
}

/**
 * Builds the component context handed to a hook: the bound element + page data, merged
 * with the matched route's slice (params/meta/locale/url). Defaults to {@link EMPTY_ROUTE}
 * when no route is supplied (headless, tests, public `scan()`).
 *
 * @param element - The element the instance is bound to.
 * @param data - The current page data payload.
 * @param route - The matched-route slice for the current URL.
 * @returns The hook context.
 * @example
 * const ctx = makeContext(element, data, route);
 */
function makeContext(
  element: Element,
  data: PageData,
  route: RouteSlice = EMPTY_ROUTE
): ComponentContext {
  return {
    el: element,
    data,
    params: route.params,
    meta: route.meta,
    locale: route.locale,
    url: route.url
  };
}

/**
 * Mounts a single `data-component` element: classifies persistent vs
 * page-specific, builds the instance, fires `onCreate` then `onMount`, records
 * it in state, and emits `spa:component-mount`. No-ops if the element is already
 * mounted, has no component name, or names an unregistered component.
 *
 * @param state - The plugin state (registeredComponents + instances).
 * @param emit - The event emitter for spa:component-mount.
 * @param swapArea - The swap-region element, or null when none was found.
 * @param data - The current page data payload.
 * @param element - The candidate element carrying a `data-component` attribute.
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

  // Skip elements whose component name is missing or unregistered.
  const name = element.dataset.component;
  if (!name) return;
  const definition = state.registeredComponents.get(name);
  if (!definition) return;

  // Persistent when outside the swap area (or when there is no swap area).
  const isPersistent = swapArea ? !swapArea.contains(element) : true;
  const instance = createInstance(definition, element, isPersistent);
  const ctx = makeContext(element, data, route);

  // Run creation hooks, record the instance, and announce the mount.
  runHook(instance, "onCreate", ctx);
  runHook(instance, "onMount", ctx);
  state.instances.set(element, instance);
  emit("spa:component-mount", { name: definition.name, el: element });
}

/**
 * Scans the swap region, mounts components for matching `data-component`
 * elements, classifies persistent (outside swap area) vs page-specific (inside),
 * fires `onCreate` then `onMount`, and emits `spa:component-mount` per instance.
 * Already-mounted elements are skipped.
 *
 * @param state - The plugin state (registeredComponents + instances).
 * @param emit - The event emitter for spa:component-mount.
 * @param swapSelector - CSS selector bounding page-specific components.
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
  for (const element of document.querySelectorAll<HTMLElement>("[data-component]")) {
    mountElement(state, emit, swapArea, data, element, route);
  }
}

/**
 * Unmounts page-specific instances inside the swap region (runs `onUnMount`
 * then `onDestroy`), removes them from state, and emits `spa:component-unmount`.
 * Persistent instances (outside the swap area) are left in place.
 *
 * @param state - The plugin state holding live instances.
 * @param emit - The event emitter for spa:component-unmount.
 * @example
 * unmountPageSpecific(state, emit);
 */
export function unmountPageSpecific(state: SpaState, emit: SpaEmitFunction): void {
  const data = typeof document === "undefined" ? {} : extractPageData(document);
  for (const [element, instance] of state.instances) {
    if (instance.persistent) continue;
    const ctx = makeContext(element, data);
    runHook(instance, "onUnMount", ctx);
    runHook(instance, "onDestroy", ctx);
    state.instances.delete(element);
    emit("spa:component-unmount", { name: instance.def.name, el: element });
  }
}

/**
 * Disposes ALL live instances (persistent and page-specific) on teardown:
 * runs `onUnMount` then `onDestroy`, emits `spa:component-unmount`, and clears
 * the instance map. Used by the kernel's `dispose` on plugin stop.
 *
 * @param state - The plugin state holding live instances.
 * @param emit - The event emitter for spa:component-unmount.
 * @example
 * unmountAll(state, emit);
 */
export function unmountAll(state: SpaState, emit: SpaEmitFunction): void {
  const data = typeof document === "undefined" ? {} : extractPageData(document);
  for (const [element, instance] of state.instances) {
    const ctx = makeContext(element, data);
    runHook(instance, "onUnMount", ctx);
    runHook(instance, "onDestroy", ctx);
    emit("spa:component-unmount", { name: instance.def.name, el: element });
  }
  state.instances.clear();
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
  const data = typeof document === "undefined" ? {} : extractPageData(document);
  for (const [element, instance] of state.instances) {
    runHook(instance, "onNavStart", makeContext(element, data));
  }
}

/**
 * Fires `onNavEnd` on persistent instances that survived the swap (page-specific
 * instances were already destroyed and re-created by the swap).
 *
 * @param state - The plugin state holding live instances.
 * @param route - The matched-route slice for the destination URL (params/meta/locale/url).
 * @example
 * notifyNavEnd(state, route);
 */
export function notifyNavEnd(state: SpaState, route: RouteSlice = EMPTY_ROUTE): void {
  const data = typeof document === "undefined" ? {} : extractPageData(document);
  for (const [element, instance] of state.instances) {
    if (instance.persistent) runHook(instance, "onNavEnd", makeContext(element, data, route));
  }
}
