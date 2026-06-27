/**
 * @file collection plugin — state factory.
 */
import type { CollectionConfig, CollectionState } from "./types";

/**
 * Creates initial collection state: a null `lastWrite` slot (populated by the Node
 * `write()` side) and an empty `cache` (populated lazily by the browser
 * `at(collection, shard)` side on first fetch).
 *
 * @param _ctx - Minimal context with global and config.
 * @param _ctx.global - Global framework configuration.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns Fresh collection state with no recorded write and an empty per-shard cache.
 * @example
 * ```ts
 * const state = createCollectionState({ global: {}, config });
 * ```
 */
export function createCollectionState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<CollectionConfig>;
}): CollectionState {
  // eslint-disable-next-line unicorn/no-null -- null until the first write()
  return { lastWrite: null, cache: new Map() };
}
