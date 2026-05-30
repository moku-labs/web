/**
 * @file env plugin — API factory: get / require / has / getPublic / getPublicMap.
 */
import type { EnvApi, EnvState } from "./types";

/** Error prefix for all env API failures. */
const ERROR_PREFIX = "[web]";

/** Core-plugin context surface available to the env API factory. */
type EnvContext = {
  readonly state: EnvState;
};

/**
 * Creates the env plugin API surface mounted at `ctx.env`. Closes over
 * `ctx.state` ({@link EnvState}) and reads the frozen `resolved` / `publicMap`
 * maps; closures never return a raw `ctx.state` reference.
 *
 * @param ctx - Core plugin context carrying the frozen env state.
 * @param ctx.state - The resolved + public {@link EnvState} maps.
 * @returns The {@link EnvApi} accessor surface mounted at `ctx.env`.
 * @example
 * ```ts
 * const api = createEnvApi(ctx);
 * api.get("PUBLIC_API_URL");
 * ```
 */
export function createEnvApi(ctx: EnvContext): EnvApi {
  const { resolved, publicMap } = ctx.state;
  return {
    /**
     * Reads a resolved variable.
     *
     * @param key - Variable name.
     * @returns The value, or `undefined` if not present.
     * @example
     * ```ts
     * api.get("PUBLIC_API_URL");
     * ```
     */
    get(key: string): string | undefined {
      return resolved.get(key);
    },
    /**
     * Reads a variable that must exist.
     *
     * @param key - Variable name.
     * @returns The value.
     * @throws {Error} If the variable is undefined.
     * @example
     * ```ts
     * api.require("DEPLOY_TOKEN");
     * ```
     */
    require(key: string): string {
      const value = resolved.get(key);
      if (value === undefined) {
        throw new Error(`${ERROR_PREFIX} env: required variable "${key}" is not defined.`);
      }
      return value;
    },
    /**
     * Tests presence of a resolved variable.
     *
     * @param key - Variable name.
     * @returns `true` if a value is present.
     * @example
     * ```ts
     * api.has("PUBLIC_API_URL");
     * ```
     */
    has(key: string): boolean {
      return resolved.has(key);
    },
    /**
     * Returns all public variables as a frozen plain object — a fresh copy,
     * never the raw state map.
     *
     * @returns A frozen `Record` of public variable names to values.
     * @example
     * ```ts
     * const payload = { ...api.getPublic() };
     * ```
     */
    getPublic(): Readonly<Record<string, string>> {
      return Object.freeze(Object.fromEntries(publicMap));
    },
    /**
     * Returns the already-frozen map of public variables.
     *
     * @returns The frozen public map.
     * @example
     * ```ts
     * [...api.getPublicMap()];
     * ```
     */
    getPublicMap(): ReadonlyMap<string, string> {
      return publicMap;
    }
  };
}
