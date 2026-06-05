/**
 * @file router plugin — state factory skeleton.
 *
 * Returns the mutable matcher-table holder (`{ table: null }`). The compiled
 * `MatcherTable` is assigned later in `onInit`, which has full dependency context.
 * No inline type assertions (R6).
 */
import type { RouterConfig, RouterState } from "./types";

/**
 * Creates initial router plugin state — a holder whose `table` is `null` until
 * `onInit` compiles and assigns the matcher table.
 *
 * @param _ctx - Minimal context with global and config.
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved router configuration.
 * @returns The initial router state holder.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: { mode: "hybrid" } });
 * ```
 */
export function createState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<RouterConfig>;
}): RouterState {
  // eslint-disable-next-line unicorn/no-null -- `table` is `MatcherTable | null` until set() compiles it
  return { table: null };
}
