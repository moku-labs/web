import { createCoreConfig } from "@moku-labs/core";

/**
 * Global configuration shape for the framework.
 *
 * @example
 * ```ts
 * type Config = { port: number; host: string };
 * ```
 */
// biome-ignore lint/complexity/noBannedTypes: placeholder for user-defined config
type Config = {};

/**
 * Event contract for the framework.
 *
 * @example
 * ```ts
 * type Events = { "app:ready": { timestamp: number } };
 * ```
 */
// biome-ignore lint/complexity/noBannedTypes: placeholder for user-defined events
type Events = {};

export const coreConfig = createCoreConfig<Config, Events>("web", {
  config: {}
});

export const { createPlugin, createCore } = coreConfig;
