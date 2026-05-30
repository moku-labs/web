/**
 * @file deploy plugin — state factory.
 */
import type { Config, State } from "./types";

/**
 * Creates initial deploy plugin state. lastDeployment starts null; spawn defaults
 * to the real Bun.spawn (swapped for a mock in unit tests).
 *
 * @param _ctx - Minimal context with global and config.
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns The initial deploy state.
 * @example
 * ```ts
 * const state = createState({ global: {}, config });
 * ```
 */
export function createState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return {
    // eslint-disable-next-line unicorn/no-null -- State.lastDeployment is `DeployResult | null` by contract.
    lastDeployment: null,
    spawn: Bun.spawn
  };
}
