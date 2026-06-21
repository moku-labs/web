/**
 * @file spa plugin — API factory (registration / control surface).
 *
 * All methods delegate to the single shared kernel stored in `ctx.state.kernel`
 * (built once in `onInit`). `register` additionally logs a collision warning via
 * `ctx.log.warn` so config-then-runtime ordering stays predictable.
 */
import type { SpaApi, SpaContext } from "./types";

/**
 * Creates the spa plugin API surface (registration / control). All methods
 * delegate to the single shared kernel stored in `ctx.state.kernel`.
 *
 * @param ctx - Plugin context exposing `state` (kernel) and `log`.
 * @returns The {@link SpaApi} surface mounted at `app.spa`.
 * @example
 * const api = createApi(ctx);
 * api.register(counter);
 */
export function createApi(ctx: SpaContext): SpaApi {
  return {
    /**
     * Register a island definition (last-registered-wins); warns on collision.
     *
     * @param island - The island definition created via `createIsland`.
     * @example
     * app.spa.register(counter);
     */
    register(island) {
      if (ctx.state.registeredIslands.has(island.name)) {
        ctx.log.warn("spa:island-collision", { name: island.name });
      }
      ctx.state.kernel?.register(island);
    },
    /**
     * Programmatically navigate to a path (client runtime; no-op without a DOM).
     *
     * @param path - Target path (pathname, optionally with search/hash).
     * @example
     * app.spa.navigate("/about");
     */
    navigate(path) {
      ctx.state.kernel?.processNav(path);
    },
    /**
     * Read the current resolved URL.
     *
     * @returns The current pathname + search.
     * @example
     * app.spa.current();
     */
    current() {
      return ctx.state.currentUrl;
    },
    /**
     * Resolve a registered island's api by name (the cross-island seam). Returns
     * `undefined` when no provider with that name is currently registered.
     *
     * @param name - The provider island's island name.
     * @returns The provider's api, or `undefined`.
     * @example
     * app.spa.island("lightbox");
     */
    island<T = unknown>(name: string): T | undefined {
      return ctx.state.islandApis.get(name) as T | undefined;
    }
  };
}
