/**
 * @file log plugin — state factory: fresh in-memory trace + sink list.
 */
import type { LogState } from "./types";

/**
 * Create fresh log state: an empty append-only trace and an empty sink list.
 * No module-level singletons — guarantees per-`createApp` isolation (two
 * `createApp` calls never share `entries` or `sinks`).
 *
 * @param _ctx - Core plugin context (`{ config }`); unused at construction.
 * @returns A fresh `LogState` with empty `entries` and `sinks` arrays.
 * @example
 * ```ts
 * const state = createLogState({ config: { mode: "test" } }); // { entries: [], sinks: [] }
 * ```
 */
export function createLogState(_ctx: unknown): LogState {
  return { entries: [], sinks: [] };
}
