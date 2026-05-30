/**
 * @file spa plugin — API factory skeleton.
 * @see README.md
 */
import type { SpaApi } from "./types";

/**
 * Creates the spa plugin API surface (registration / control). All methods
 * delegate to the single shared kernel stored in `ctx.state.kernel`.
 *
 * @param _ctx - Plugin context (unused in skeleton).
 * @example
 * const api = createApi(ctx);
 */
export function createApi(_ctx: unknown): SpaApi {
  throw new Error("not implemented");
}
