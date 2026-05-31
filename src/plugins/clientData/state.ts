/**
 * @file clientData plugin — state factory.
 */
import type { ClientDataConfig, ClientDataState } from "./types";

/**
 * Creates initial clientData state — a null `lastEmit` slot populated on the
 * first {@link ClientDataApi.emit} call.
 *
 * @param _ctx - Minimal context with global and config.
 * @param _ctx.global - Global framework configuration.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns Fresh clientData state with no recorded emit.
 * @example
 * ```ts
 * const state = createClientDataState({ global: {}, config });
 * ```
 */
export function createClientDataState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<ClientDataConfig>;
}): ClientDataState {
  // eslint-disable-next-line unicorn/no-null -- `lastEmit` is null until the first emit()
  return { lastEmit: null };
}
