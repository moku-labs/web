/**
 * @file spa plugin — onStop teardown closure handles + capture/dispose helpers.
 *
 * Holds the module-scope closure handles `onStop` needs but cannot reach
 * (spec/08 §4: TeardownContext is `{ global }`-only — no `state`/`log`). They are
 * captured during `onStart` and released in `onStop`. Single-app-per-process by
 * design (the only module-scope state is these runtime handles — never kernel data).
 */

import type { LogApi } from "../log/types";
import { kernelRef } from "./kernel";
import type { SpaContext } from "./types";

/** Router/instance teardown captured during onStart (undefined when stopped). */
let teardown: (() => void) | undefined;
/** Captured log ref — onStop has no `ctx.log` (spec/08 §4). */
let logRef: LogApi | undefined;

/**
 * Dispose the active kernel (captured as the teardown closure during onStart).
 *
 * @example
 * disposeKernel();
 */
function disposeKernel(): void {
  kernelRef.current?.dispose();
}

/**
 * Capture the teardown + log handles during `onStart` (no-op without a DOM —
 * the SSR/build guard, so onStop has nothing to release). The kernel itself is
 * booted by index.ts after this capture.
 *
 * @param ctx - The plugin context (used for `log` capture).
 * @example
 * captureTeardown(ctx);
 */
export function captureTeardown(ctx: SpaContext): void {
  if (typeof document === "undefined") return;
  logRef = ctx.log;
  teardown = disposeKernel;
}

/**
 * Release everything `captureTeardown`/`onStart` acquired: run teardown in
 * try/catch (logging via the captured ref), then clear both handles. Idempotent —
 * a second call is a no-op (spec/11 §4.2) and mirrors `onStart` (§4.1).
 *
 * @example
 * disposeSpa();
 */
export function disposeSpa(): void {
  try {
    teardown?.();
  } catch (error) {
    logRef?.error("spa:teardown-failed", {}, error as Error);
  } finally {
    teardown = undefined;
    logRef = undefined;
  }
}
