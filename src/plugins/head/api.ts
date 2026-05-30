/**
 * @file head plugin — API factory skeleton
 */
import type { Api } from "./types";

/**
 * Creates the head plugin API surface.
 *
 * The `render` method pulls `site`/`i18n`/`router` via `ctx.require` at call time,
 * composes the head element set via `compose.ts`, and serializes it to a string.
 *
 * @param _ctx - Plugin context (unused in skeleton).
 * @example
 * ```ts
 * const api = createApi(ctx);
 * ```
 */
export function createApi(_ctx: unknown): Api {
  throw new Error("not implemented");
}
