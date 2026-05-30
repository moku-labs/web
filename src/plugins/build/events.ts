/**
 * @file build plugin — event descriptor declarations (extracted from index wiring).
 */
import type { RegisterFunction } from "@moku-labs/core";
import type { PhaseName } from "./types";

/**
 * Declares the `build` plugin events: `build:phase` (per-phase start/done
 * boundaries) and `build:complete` (one successful-run summary).
 *
 * @param register - The typed event registration helper from the plugin factory.
 * @returns The event descriptor map keyed by event name.
 * @example
 * ```ts
 * const events = createEvents(register);
 * ```
 */
export function createEvents(register: RegisterFunction) {
  return {
    "build:phase": register<{
      phase: PhaseName;
      status: "start" | "done";
      durationMs?: number;
    }>("Emitted at each build phase boundary (start/done)"),
    "build:complete": register<{
      outDir: string;
      pageCount: number;
      durationMs: number;
    }>("Emitted once after a successful build run")
  };
}
