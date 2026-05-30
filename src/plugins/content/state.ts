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
 * @returns Fresh content state: null processor, empty caches.
 * @example
 * ```ts
 * const state = createContentState({ global: {}, config });
 * ```
 */
export function createContentState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return {
    // eslint-disable-next-line unicorn/no-null -- `processor` is `Processor | null` until first render builds it
    processor: null,
    articles: new Map(),
    // eslint-disable-next-line unicorn/no-null -- `slugs` is `string[] | null` until the first disk scan
    slugs: null,
    dirtyPaths: new Set()
  };
}
