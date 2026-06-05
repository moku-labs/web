/**
 * @file content plugin — state factory skeleton (shell).
 */
import type { Config, State } from "./types";

/**
 * Creates initial content plugin shell state — an empty article cache. The lazy
 * unified processor + discovery caches live in the provider, not here.
 *
 * @param _ctx - Minimal context with global and config.
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns Fresh content shell state: an empty article cache.
 * @example
 * ```ts
 * const state = createContentState({ global: {}, config: { providers: [] } });
 * ```
 */
export function createContentState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return { articles: new Map() };
}
