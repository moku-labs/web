/**
 * @file router plugin — API factory skeleton.
 *
 * Closures over `ctx.state.table` exposing `match` / `toUrl` / `entries` /
 * `manifest`. Returns values/copies, never the raw `ctx.state` reference (spec/11 §2.4).
 */
import type { RouterApi } from "./types";

/**
 * Creates the router plugin API surface.
 *
 * @param _ctx - Plugin context (unused in skeleton).
 * @example
 * ```ts
 * const api = createApi(ctx);
 * ```
 */
export function createApi(_ctx: unknown): RouterApi {
  throw new Error("not implemented");
}
