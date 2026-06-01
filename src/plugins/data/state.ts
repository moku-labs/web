/**
 * @file data plugin — state factory.
 */
import type { DataConfig, DataState } from "./types";

/**
 * Creates initial data state: a null `lastWrite` slot (populated by the Node
 * `write()` side) and an empty `cache` (populated lazily by the browser `at(path)`
 * side on first fetch).
 *
 * @param _ctx - Minimal context with global and config.
 * @param _ctx.global - Global framework configuration.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns Fresh data state with no recorded write and an empty per-path cache.
 * @example
 * ```ts
 * const state = createDataState({ global: {}, config });
 * ```
 */
export function createDataState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<DataConfig>;
}): DataState {
  // eslint-disable-next-line unicorn/no-null -- null until the first write()
  return { lastWrite: null, cache: new Map() };
}
