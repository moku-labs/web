/**
 * @file content plugin — state factory skeleton.
 */
import type { Config, State } from "./types";

/**
 * Creates initial content plugin state — empty containers and a null processor
 * slot (the processor is lazily built on first loadAll()/renderMarkdown()).
 *
 * @param _ctx - Minimal context with global and config.
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved plugin configuration.
 * @example
 * ```ts
 * const state = createContentState({ global: {}, config });
 * ```
 */
export function createContentState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  throw new Error("not implemented");
}
