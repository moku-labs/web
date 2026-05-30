/**
 * @file env plugin — onInit resolution pipeline + freezeMap immutability helper.
 */

/**
 * Resolves, validates, and freezes the environment table at `onInit`.
 *
 * Pipeline order: merge providers (with empty-string → undefined coercion) →
 * `PUBLIC_` bidirectional cross-check → apply defaults → assert required →
 * populate `state.resolved` / `state.publicMap` → freeze both via
 * {@link freezeMap}. Fail-fast: any violation throws at `createApp` time.
 *
 * @param _ctx - Core plugin context (`{ config, state }`); unused in skeleton.
 * @example
 * ```ts
 * validateSchema(ctx); // throws on missing required / PUBLIC_ violation
 * ```
 */
export function validateSchema(_ctx: unknown): void {
  throw new Error("[web] not implemented");
}

/**
 * Seals a map so `set`, `clear`, and `delete` throw, then `Object.freeze`s it
 * for defense in depth. Closes the `Object.freeze`-on-`Map` mutability hole by
 * redefining the mutators as non-writable, non-configurable throwers.
 *
 * @param _map - The map to freeze in place.
 * @example
 * ```ts
 * freezeMap(state.resolved); // resolved.set(...) now throws
 * ```
 */
export function freezeMap(_map: Map<string, string>): void {
  throw new Error("[web] not implemented");
}
