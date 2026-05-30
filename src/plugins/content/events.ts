/**
 * @file content plugin — event registry skeleton.
 */
import type { RegisterFunction } from "@moku-labs/core";

/**
 * Registers the content plugin's notification-only events (`content:ready`,
 * `content:invalidated`) with their typed payloads. Referenced as the plugin's
 * `events` callback so index.ts stays wiring-only.
 *
 * @param register - Kernel-provided typed event registrar.
 * @returns The content event descriptor map.
 * @example
 * ```ts
 * createPlugin("content", { events: contentEvents });
 * ```
 */
export const contentEvents = (register: RegisterFunction) => ({
  "content:ready": register<{ locales: readonly string[]; articleCount: number }>(
    "All articles loaded across locales"
  ),
  "content:invalidated": register<{ paths: readonly string[] }>(
    "Article paths marked stale for dev rebuild"
  )
});
