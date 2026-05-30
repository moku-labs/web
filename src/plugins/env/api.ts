/**
 * @file env plugin — API factory: get / require / has / getPublic / getPublicMap.
 */
import type { EnvApi } from "./types";

/**
 * Creates the env plugin API surface mounted at `ctx.env`. Closes over
 * `ctx.state` ({@link EnvState}) and reads the frozen `resolved` / `publicMap`
 * maps; closures never return a raw `ctx.state` reference.
 *
 * @param _ctx - Core plugin context (unused in skeleton).
 * @returns The {@link EnvApi} accessor surface mounted at `ctx.env`.
 * @example
 * ```ts
 * const api = createEnvApi(ctx);
 * ```
 */
export function createEnvApi(_ctx: unknown): EnvApi {
  return {
    /**
     * Reads a resolved variable.
     *
     * @param _key - Variable name.
     * @example
     * ```ts
     * api.get("PUBLIC_API_URL");
     * ```
     */
    get(_key: string): string | undefined {
      throw new Error("[web] not implemented");
    },
    /**
     * Reads a variable that must exist.
     *
     * @param _key - Variable name.
     * @throws {Error} If the variable is undefined.
     * @example
     * ```ts
     * api.require("DEPLOY_TOKEN");
     * ```
     */
    require(_key: string): string {
      throw new Error("[web] not implemented");
    },
    /**
     * Tests presence of a resolved variable.
     *
     * @param _key - Variable name.
     * @example
     * ```ts
     * api.has("PUBLIC_API_URL");
     * ```
     */
    has(_key: string): boolean {
      throw new Error("[web] not implemented");
    },
    /**
     * Returns all public variables as a frozen plain object.
     *
     * @example
     * ```ts
     * api.getPublic();
     * ```
     */
    getPublic(): Readonly<Record<string, string>> {
      throw new Error("[web] not implemented");
    },
    /**
     * Returns the frozen map of public variables.
     *
     * @example
     * ```ts
     * api.getPublicMap();
     * ```
     */
    getPublicMap(): ReadonlyMap<string, string> {
      throw new Error("[web] not implemented");
    }
  };
}
