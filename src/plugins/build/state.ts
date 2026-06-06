/**
 * @file build plugin — state factory (per-run caches + OG hash cache).
 */
import type { Config, State } from "./types";

/**
 * Creates initial `build` plugin state: a frozen config snapshot plus empty
 * per-run caches (`manifest`, `buildCache`, `runId`) and the cross-run OG
 * content-hash + page-render caches. Holds caches and config only — no domain data
 * is duplicated here (pulled fresh via `ctx.require` each run).
 *
 * @param ctx - Minimal context with global and config.
 * @param ctx.global - Global plugin registry (unused; caches are config-driven).
 * @param ctx.config - Resolved plugin configuration snapshot.
 * @returns The initial per-run `build` state.
 * @example
 * ```ts
 * const state = createState({ global: {}, config });
 * ```
 */
export function createState(ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return {
    config: ctx.config,
    // eslint-disable-next-line unicorn/no-null -- `manifest` is `RouteDefinition[] | null` until the pages phase populates it
    manifest: null,
    buildCache: new Map<string, unknown>(),
    // eslint-disable-next-line unicorn/no-null -- `runId` is `string | null` until a run starts
    runId: null,
    ogImageHashCache: new Map<string, string>(),
    renderCache: new Map()
  };
}
