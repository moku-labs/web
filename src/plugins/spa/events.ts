/**
 * @file spa plugin — event registration callback (extracted from index wiring).
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";

/**
 * Declares the spa plugin's events. Extracted from index.ts to keep the wiring
 * file under the line budget.
 *
 * @param register - The event registration function supplied by the kernel.
 * @returns The map of spa event descriptors.
 * @example
 * const events = spaEvents(register);
 */
export function spaEvents(register: RegisterFunction) {
  return {
    "spa:navigate": register<{ from: string; to: string }>(
      "A navigation has been intercepted and is starting."
    ),
    "spa:navigated": register<{ url: string }>("The swap completed and the new URL is active."),
    "spa:island-mount": register<{ name: string; el: Element }>(
      "A island instance attached to an element."
    ),
    "spa:island-unmount": register<{ name: string; el: Element }>(
      "A island instance detached from an element."
    )
  };
}
