/**
 * @file env plugin — browser-safe provider (zero `node:*`).
 *
 * Companion to `./providers.ts` (which imports `node:fs` for dotenv). This module
 * is the browser-bundle-safe source: it reads `import.meta.env` and an optional
 * `globalThis` key, so the default client composition never drags the Node graph
 * into the browser bundle. The implementation lands in web-parity wave 1.
 */
import type { EnvProvider } from "./types";

/**
 * A browser-safe {@link EnvProvider} that reads `import.meta.env` and an optional
 * `globalThis[globalKey]` snapshot. Contains zero `node:*` imports, so it is safe
 * to include in the client bundle.
 *
 * @param _options - Optional settings.
 * @param _options.globalKey - `globalThis` key to read a public-env snapshot from.
 * @throws {Error} Always — implemented in web-parity wave 1.
 * @example
 * ```ts
 * hydrate({ env: [browserEnv()] });
 * ```
 */
export function browserEnv(_options?: { globalKey?: string }): EnvProvider {
  throw new Error("browserEnv: not implemented (web-parity wave 1)");
}
