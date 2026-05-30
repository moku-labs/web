/**
 * @file deploy plugin — state factory.
 */
import type { Config, SpawnFunction, State } from "./types";
import { deployError } from "./wrangler";

/**
 * Default subprocess spawner. Resolves `Bun.spawn` lazily at call time (rather
 * than binding it at state creation) so the spawner can be exercised in tests and
 * fails with a coded error in a non-Bun runtime instead of a raw `TypeError`.
 *
 * @param cmd - The argv array to spawn (no shell).
 * @param options - The Bun spawn options (stdout/stderr/env).
 * @returns The spawned subprocess handle.
 * @throws {Error} `ERR_DEPLOY_WRANGLER_FAILED` when no Bun runtime is available.
 * @example
 * defaultSpawn(["bunx", "wrangler"], { stdout: "pipe", stderr: "pipe" });
 */
const defaultSpawn: SpawnFunction = (cmd, options) => {
  const runtime = (globalThis as { Bun?: { spawn: SpawnFunction } }).Bun;
  if (runtime === undefined) {
    throw deployError(
      "ERR_DEPLOY_WRANGLER_FAILED",
      "[web] deploy: no Bun runtime available to spawn wrangler.\n  Run deploy under Bun, or inject a spawn function in tests."
    );
  }
  return runtime.spawn(cmd, options);
};

/**
 * Creates initial deploy plugin state. `lastDeployment` starts `null`; `spawn`
 * defaults to a lazy `Bun.spawn` wrapper (swapped for a mock in unit tests so
 * wrangler is never actually invoked).
 *
 * @param _ctx - Minimal context with global and config (unused — state is static).
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns The initial deploy state.
 * @example
 * const state = createState({ global: {}, config });
 */
export function createState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return {
    // eslint-disable-next-line unicorn/no-null -- State.lastDeployment is `DeployResult | null` by contract.
    lastDeployment: null,
    spawn: defaultSpawn
  };
}
