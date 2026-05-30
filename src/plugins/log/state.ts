/**
 * @file log plugin — state factory skeleton.
 */
import type { LogState } from "./types";

/**
 * Create fresh log state: an empty append-only trace and an empty sink list.
 * No module-level singletons — guarantees per-`createApp` isolation.
 *
 * @param _ctx - Core plugin context (unused at construction).
 * @example
 * ```ts
 * const state = createLogState(ctx); // { entries: [], sinks: [] }
 * ```
 */
export function createLogState(_ctx: unknown): LogState {
  throw new Error("not implemented");
}
