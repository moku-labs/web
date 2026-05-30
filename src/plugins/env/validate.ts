/**
 * @file env plugin — onInit resolution pipeline + freezeMap immutability helper.
 */
import type { EnvConfig, EnvState } from "./types";

/** Error message thrown by every frozen-map mutator. */
const FROZEN_MESSAGE = "env: map is frozen and cannot be mutated";
/** Error prefix for all resolution-pipeline failures. */
const ERROR_PREFIX = "[web]";

/** Core-plugin context surface (`{ config, state }`) consumed by `validateSchema`. */
type EnvValidationContext = {
  readonly config: EnvConfig;
  state: EnvState;
};

/**
 * Throws the canonical frozen-map error; installed as a map's `set`/`clear`/`delete`.
 *
 * @throws {TypeError} Always, signalling the map is frozen.
 * @example
 * ```ts
 * frozenThrower(); // throws TypeError
 * ```
 */
function frozenThrower(): never {
  throw new TypeError(FROZEN_MESSAGE);
}

/**
 * Merges providers in array order, coercing empty strings to `undefined` before
 * precedence so a `KEY=""` falls through to later providers. First non-empty
 * value wins.
 *
 * @param config - The resolved env config carrying the ordered providers.
 * @returns A flat record of the first defined value found per key.
 * @example
 * ```ts
 * mergeProviders({ providers: [a, b], schema: {}, publicPrefix: "PUBLIC_" });
 * ```
 */
function mergeProviders(config: EnvConfig): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const provider of config.providers) {
    const values = provider.load();
    for (const [key, raw] of Object.entries(values)) {
      const value = raw === "" ? undefined : raw;
      if (value !== undefined && merged[key] === undefined) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

/**
 * Bidirectionally enforces the `PUBLIC_` naming convention against each schema
 * entry's `public` flag. Throws on either violation direction.
 *
 * @param config - The resolved env config carrying `schema` + `publicPrefix`.
 * @throws {Error} If a public var lacks the prefix, or a prefixed var is not public.
 * @example
 * ```ts
 * crossCheckPublicPrefix(config); // throws if PUBLIC_X is not public:true
 * ```
 */
function crossCheckPublicPrefix(config: EnvConfig): void {
  const { schema, publicPrefix } = config;
  for (const [key, spec] of Object.entries(schema)) {
    const hasPrefix = key.startsWith(publicPrefix);
    if (spec.public === true && !hasPrefix) {
      throw new Error(
        `${ERROR_PREFIX} env: "${key}" is marked public but does not start with "${publicPrefix}".`
      );
    }
    if (hasPrefix && spec.public !== true) {
      throw new Error(
        `${ERROR_PREFIX} env: "${key}" starts with "${publicPrefix}" but is not marked public:true.`
      );
    }
  }
}

/**
 * Seals a map so `set`, `clear`, and `delete` throw, then `Object.freeze`s it
 * for defense in depth. Closes the `Object.freeze`-on-`Map` mutability hole by
 * redefining the mutators as non-writable, non-configurable throwers.
 *
 * @param map - The map to freeze in place.
 * @example
 * ```ts
 * freezeMap(state.resolved); // resolved.set(...) now throws
 * ```
 */
export function freezeMap(map: Map<string, string>): void {
  for (const method of ["set", "clear", "delete"] as const) {
    Object.defineProperty(map, method, {
      value: frozenThrower,
      writable: false,
      configurable: false,
      enumerable: false
    });
  }
  Object.freeze(map);
}

/**
 * Resolves, validates, and freezes the environment table at `onInit`.
 *
 * Pipeline order: merge providers (with empty-string → undefined coercion) →
 * `PUBLIC_` bidirectional cross-check → apply defaults → assert required →
 * populate `state.resolved` / `state.publicMap` → freeze both via
 * {@link freezeMap}. Fail-fast: any violation throws at `createApp` time.
 *
 * @param ctx - Core plugin context (`{ config, state }`).
 * @param ctx.config - The resolved {@link EnvConfig}.
 * @param ctx.state - The mutable {@link EnvState} to populate and freeze.
 * @throws {Error} On a `PUBLIC_` cross-check violation or a missing required variable.
 * @example
 * ```ts
 * validateSchema(ctx); // throws on missing required / PUBLIC_ violation
 * ```
 */
export function validateSchema(ctx: EnvValidationContext): void {
  const { config, state } = ctx;
  const { schema } = config;
  const merged = mergeProviders(config);

  crossCheckPublicPrefix(config);

  for (const [key, spec] of Object.entries(schema)) {
    if (merged[key] === undefined && spec.default !== undefined) {
      merged[key] = spec.default;
    }
    if (merged[key] === undefined && spec.required === true) {
      throw new Error(
        `${ERROR_PREFIX} env: required variable "${key}" is not defined by any provider or default.`
      );
    }
  }

  // publicMap is the schema-driven subset (public:true keys with a value) — the
  // only sanctioned input to a browser-facing `define`, so it stays schema-scoped.
  for (const [key, spec] of Object.entries(schema)) {
    const value = merged[key];
    if (spec.public === true && value !== undefined) state.publicMap.set(key, value);
  }

  // resolved holds EVERY merged key with a defined value (spec/02 Lifecycle §5),
  // including non-schema provider keys so `ctx.env.require()` works for dynamic keys.
  for (const [key, value] of Object.entries(merged)) {
    state.resolved.set(key, value);
  }

  freezeMap(state.resolved);
  freezeMap(state.publicMap);
}
