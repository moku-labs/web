/**
 * @file env plugin — state factory: empty resolved + publicMap maps.
 */
import type { EnvState } from "./types";

/**
 * Creates initial env plugin state: two empty, mutable maps that are populated
 * and frozen by `validateSchema` (the `onInit`) at `createApp` time.
 *
 * @returns A fresh `EnvState` with empty `resolved` and `publicMap` maps.
 * @example
 * ```ts
 * const state = createEnvState();
 * state.resolved.size; // 0
 * ```
 */
export function createEnvState(): EnvState {
  return { resolved: new Map(), publicMap: new Map() };
}
