/**
 * @file spa plugin — component lifecycle, mounting, and createComponent helper.
 * @see README.md
 */

import type { SpaEmit } from "./kernel";
import type {
  ComponentContext,
  // eslint-disable-next-line unicorn/prevent-abbreviations -- canonical public type name per spec
  ComponentDef,
  ComponentHooks,
  ComponentInstance,
  PageData,
  SpaState
} from "./types";

/**
 * Create a validated component definition. Validates hook names at registration
 * for fail-fast typo detection (e.g. `onMout` throws immediately).
 *
 * @param _name - Unique component name.
 * @param _hooks - Lifecycle hook implementations.
 * @throws {Error} If `_name` is empty, any hook key is not in
 *   `COMPONENT_HOOK_NAMES`, or any provided hook value is not a function.
 * @example
 * const counter = createComponent("counter", {
 *   onMount({ el }) { el.textContent = "0"; }
 * });
 */
export function createComponent(_name: string, _hooks: ComponentHooks): ComponentDef {
  throw new Error("not implemented");
}

/**
 * Scans the swap region, mounts components for matching `data-component`
 * elements, classifies persistent vs page-specific, and emits
 * spa:component-mount per instance.
 *
 * @param _state - The plugin state (registeredComponents + instances).
 * @param _emit - The event emitter for spa:component-mount.
 * @param _swapSelector - CSS selector bounding page-specific components.
 * @example
 * scanAndMount(state, emit, "main > section");
 */
export function scanAndMount(_state: SpaState, _emit: SpaEmit, _swapSelector: string): void {
  throw new Error("not implemented");
}

/**
 * Unmounts page-specific instances inside the swap region (onUnMount then
 * onDestroy), removes them from state, and emits spa:component-unmount.
 *
 * @param _state - The plugin state holding live instances.
 * @param _emit - The event emitter for spa:component-unmount.
 * @example
 * unmountPageSpecific(state, emit);
 */
export function unmountPageSpecific(_state: SpaState, _emit: SpaEmit): void {
  throw new Error("not implemented");
}

/**
 * Extracts the page data payload from the inline `script#__DATA__` element.
 *
 * @param _doc - The document to read the data script from.
 * @example
 * const data = extractPageData(document);
 */
export function extractPageData(_doc: Document): PageData {
  throw new Error("not implemented");
}

/**
 * Builds a live component instance bound to an element.
 *
 * @param _definition - The component definition.
 * @param _element - The element the instance binds to.
 * @param _persistent - Whether the instance survives navigation.
 * @example
 * const inst = createInstance(definition, element, false);
 */
export function createInstance(
  _definition: ComponentDef,
  _element: Element,
  _persistent: boolean
): ComponentInstance {
  throw new Error("not implemented");
}

/**
 * Invokes a single lifecycle hook on an instance with its component context.
 *
 * @param _instance - The instance whose hook to run.
 * @param _hook - The hook name to invoke.
 * @param _ctx - The component context passed to the hook.
 * @example
 * runHook(instance, "onMount", ctx);
 */
export function runHook(
  _instance: ComponentInstance,
  _hook: keyof ComponentHooks,
  _ctx: ComponentContext
): void {
  throw new Error("not implemented");
}
