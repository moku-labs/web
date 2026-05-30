/**
 * @file env plugin — built-in providers: dotenv, processEnv, cloudflareBindings.
 */
import type { EnvProvider } from "./types";

/**
 * A zero-dependency `.env`-style provider that re-reads and re-parses the file
 * from disk on every `load()`. Missing file resolves to `{}` (optional
 * overrides). Strips a single outer quote pair; does not strip trailing inline
 * comments on unquoted values.
 *
 * @param _path - Path to the dotenv file. Defaults to `.env.local`.
 * @example
 * ```ts
 * const provider = dotenv(".env.local");
 * ```
 */
export function dotenv(_path?: string): EnvProvider {
  throw new Error("[web] not implemented");
}

/**
 * A provider that returns a shallow copy of `process.env` at `load()` time.
 *
 * @example
 * ```ts
 * const provider = processEnv();
 * ```
 */
export function processEnv(): EnvProvider {
  throw new Error("[web] not implemented");
}

/**
 * A provider that reads live, per-request Cloudflare bindings from
 * `globalThis.__CLOUDFLARE_ENV__` at `load()` time (`?? {}` when absent). Never
 * caches the binding object; the consumer owns the global's request lifecycle.
 *
 * @example
 * ```ts
 * const provider = cloudflareBindings();
 * ```
 */
export function cloudflareBindings(): EnvProvider {
  throw new Error("[web] not implemented");
}
