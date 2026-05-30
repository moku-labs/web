/**
 * @file head plugin — state factory skeleton
 */
import type { Config, State } from "./types";

/**
 * Creates initial head plugin state.
 *
 * Initializes the single `defaults` slot to `null`; `onInit` assigns the normalized
 * snapshot exactly once.
 *
 * @param _ctx - Minimal context with global and config.
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns The initial head state with a null `defaults` slot.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: {} });
 * ```
 */
export function createState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  // eslint-disable-next-line unicorn/no-null -- `defaults` is `HeadDefaults | null` until onInit assigns the snapshot
  return { defaults: null };
}
