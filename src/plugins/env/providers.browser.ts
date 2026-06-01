/**
 * @file env plugin — browser-safe provider (zero `node:*`).
 *
 * Companion to `./providers.ts` (which imports `node:fs` for dotenv). This module
 * is the browser-bundle-safe source: it reads `import.meta.env` and an optional
 * `globalThis` key, so the default client composition never drags the Node graph
 * into the browser bundle.
 */
import type { EnvProvider } from "./types";

/** Default `globalThis` property holding a runtime-injected public-env snapshot. */
const DEFAULT_GLOBAL_KEY = "__ENV__";

/**
 * A browser-safe {@link EnvProvider} that reads `import.meta.env` and an optional
 * `globalThis[globalKey]` snapshot, merging them with the runtime global winning.
 * Contains zero `node:*` imports, so it is safe to include in the client bundle.
 * Never throws on missing sources — each absent source resolves to `{}`.
 *
 * @param options - Optional settings.
 * @param options.globalKey - `globalThis` key to read a public-env snapshot from. Defaults to `"__ENV__"`.
 * @returns An {@link EnvProvider} named `browser-env`.
 * @example
 * ```ts
 * const provider = browserEnv();
 * provider.load(); // { PUBLIC_API_URL: "/api", ... }
 * ```
 */
export function browserEnv(options?: { globalKey?: string }): EnvProvider {
  const globalKey = options?.globalKey ?? DEFAULT_GLOBAL_KEY;
  return {
    name: "browser-env",
    /**
     * Merges `import.meta.env` with `globalThis[globalKey]`, the runtime global
     * winning. Each absent source resolves to `{}`; never throws.
     *
     * @returns The merged environment record.
     * @example
     * ```ts
     * browserEnv().load();
     * ```
     */
    load(): Record<string, string | undefined> {
      const importEnv = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
      const globalObject =
        ((globalThis as Record<string, unknown>)[globalKey] as
          | Record<string, string | undefined>
          | undefined) ?? {};
      return { ...importEnv, ...globalObject };
    }
  };
}
