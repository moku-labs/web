/**
 * @file `@moku-labs/web/client` — browser-safe hydrate entry point.
 *
 * The browser counterpart to the root (Node SSG) entry. Imported as
 * `@moku-labs/web/client`, it composes only the browser-safe plugins
 * (`[site, i18n, router, head, spa]`) over `browserEnv()` and mounts islands onto
 * the SSR DOM. Contains zero `node:*`/native imports so the client bundle stays
 * Node-free. The `hydrate()` implementation lands in web-parity wave 2.
 */
/**
 * Options accepted by {@link hydrate}. Shape is finalized alongside the
 * implementation in web-parity wave 2.
 */
export interface HydrateOptions {
  /** Consumer-supplied options (routes, components, config). */
  readonly [key: string]: unknown;
}

/**
 * Hydrates the SSR-rendered page in the browser: composes the browser-safe
 * plugin set over `browserEnv()`, starts a Layer-3 app, and mounts islands onto
 * the existing DOM. Idempotent-guarded against double-hydration.
 *
 * @param _options - Routes, island components, and client config.
 * @throws {Error} Always — implemented in web-parity wave 2.
 * @example
 * ```ts
 * import { hydrate } from "@moku-labs/web/client";
 * hydrate({ routes, components });
 * ```
 */
export function hydrate(_options?: HydrateOptions): Promise<void> {
  throw new Error("hydrate: not implemented (web-parity wave 2)");
}

export { browserEnv } from "./plugins/env/providers.browser";
