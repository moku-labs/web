/**
 * @file deploy plugin — typed event declarations.
 */
import type { RegisterFunction } from "@moku-labs/core";

/**
 * Declares the deploy plugin's events on the typed bus. `deploy:complete` is
 * emitted once after a successful run() with the resulting deployment details.
 *
 * @param register - The typed event registrar supplied by the core kernel.
 * @returns The plugin's event descriptor map.
 * @example
 * ```ts
 * createPlugin("deploy", { events: deployEvents });
 * ```
 */
export const deployEvents = (register: RegisterFunction) => ({
  "deploy:complete": register<{
    url: string;
    deploymentId: string;
    branch: string;
    durationMs: number;
  }>("Deployment completed successfully")
});
