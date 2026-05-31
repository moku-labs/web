/**
 * @file data plugin — state factory.
 */
import type { DataConfig, DataState } from "./types";

/**
 * Creates initial data state — a null `lastEmit` slot populated on the
 * first {@link DataApi.emit} call.
 *
 * @param _ctx - Minimal context with global and config.
 * @param _ctx.global - Global framework configuration.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns Fresh data state with no recorded emit.
 * @example
 * ```ts
 * const state = createDataState({ global: {}, config });
 * ```
 */
export function createDataState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<DataConfig>;
}): DataState {
  // eslint-disable-next-line unicorn/no-null -- `lastEmit` is null until the first emit()
  return { lastEmit: null };
}
