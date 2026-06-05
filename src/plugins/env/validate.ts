/**
 * @file env plugin — onInit resolution pipeline + freezeMap immutability helper.
 */
import type { EnvConfig, EnvState } from "./types";

/** Error message thrown by every frozen-map mutator. */
const FROZEN_MESSAGE = "env: map is frozen and cannot be mutated";
/** Error prefix for all resolution-pipeline failures. */
const ERROR_PREFIX = "[web]";
/** The `Map` mutators redefined as throwers when a map is frozen. */
const FROZEN_METHODS = ["set", "clear", "delete"] as const;

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
 * Coerces a raw provider value to its effective presence: an empty string counts
 * as "absent" so a `KEY=""` falls through to later providers.
 *
 * @param raw - The raw value a provider supplied for a key (possibly `undefined`).
 * @returns The value, or `undefined` when it is missing or an empty string.
 * @example
 * ```ts
 * coerceEmpty(""); // => undefined
 * coerceEmpty("3000"); // => "3000"
 * ```
 */
function coerceEmpty(raw: string | undefined): string | undefined {
  return raw === "" ? undefined : raw;
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

  // Walk providers in precedence order, keeping the first non-empty value per key.
  for (const provider of config.providers) {
    for (const [key, raw] of Object.entries(provider.load())) {
      const value = coerceEmpty(raw);
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
    const isPublicMissingPrefix = spec.public === true && !hasPrefix;
    if (isPublicMissingPrefix) {
      throw new Error(
        `${ERROR_PREFIX} env: "${key}" is marked public but does not start with "${publicPrefix}".`
      );
    }
    const isPrefixedNotPublic = hasPrefix && spec.public !== true;
    if (isPrefixedNotPublic) {
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
  // Seal the mutators: redefine each as a non-writable, non-configurable thrower.
  for (const method of FROZEN_METHODS) {
    Object.defineProperty(map, method, {
      value: frozenThrower,
      writable: false,
      configurable: false,
      enumerable: false
    });
  }

  // Freeze the object itself for defense in depth.
  Object.freeze(map);
}

/**
 * Populates `state.publicMap` with the schema-driven public subset: every
 * `public:true` schema key that resolved to a defined value. This map is the only
 * sanctioned input to a browser-facing `define`, so it stays schema-scoped (never
 * includes non-schema provider keys).
 *
 * @param schema - The per-variable schema from {@link EnvConfig}.
 * @param merged - The merged provider values keyed by variable name.
 * @param publicMap - The mutable public map to fill in place.
 * @example
 * ```ts
 * populatePublicMap(config.schema, merged, state.publicMap);
 * ```
 */
function populatePublicMap(
  schema: EnvConfig["schema"],
  merged: Record<string, string>,
  publicMap: EnvState["publicMap"]
): void {
  for (const [key, spec] of Object.entries(schema)) {
    const value = merged[key];
    const isExposablePublic = spec.public === true && value !== undefined;
    if (isExposablePublic) publicMap.set(key, value);
  }
}

/**
 * Populates `state.resolved` with EVERY merged key that carries a defined value
 * (spec/02 Lifecycle §5), including non-schema provider keys so
 * `ctx.env.require()` works for dynamic keys.
 *
 * @param merged - The merged provider values keyed by variable name.
 * @param resolved - The mutable resolved map to fill in place.
 * @example
 * ```ts
 * populateResolved(merged, state.resolved);
 * ```
 */
function populateResolved(merged: Record<string, string>, resolved: EnvState["resolved"]): void {
  for (const [key, value] of Object.entries(merged)) {
    resolved.set(key, value);
  }
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

  // Collapse the ordered providers into one value table and enforce the PUBLIC_ convention.
  const merged = mergeProviders(config);
  crossCheckPublicPrefix(config);

  // Backfill schema defaults, then fail fast on any required variable still missing.
  for (const [key, spec] of Object.entries(schema)) {
    const isUnset = merged[key] === undefined;
    if (isUnset && spec.default !== undefined) {
      merged[key] = spec.default;
    }
    if (merged[key] === undefined && spec.required === true) {
      throw new Error(
        `${ERROR_PREFIX} env: required variable "${key}" is not defined by any provider or default.`
      );
    }
  }

  // Publish both views: the browser-safe public subset and the full resolved table.
  populatePublicMap(schema, merged, state.publicMap);
  populateResolved(merged, state.resolved);

  // Lock both maps so post-onInit code can only read them.
  freezeMap(state.resolved);
  freezeMap(state.publicMap);
}
