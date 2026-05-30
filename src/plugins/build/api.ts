/**
 * @file build plugin — API factory (run + phases), cross-plugin wiring, and onInit config validation.
 */
import { contentPlugin } from "../content";
import { headPlugin } from "../head";
import { routerPlugin } from "../router";
import type { Api, Config } from "./types";

/** Typed default `build` config (R6: no inline `as`). `ogImage: false` disables OG generation. */
export const defaultConfig: Config = {
  outDir: "./dist",
  minify: true,
  feeds: true,
  sitemap: true,
  images: true,
  ogImage: false
};

/**
 * Minimal context shape for the api factory: exposes `require` for pulling the
 * content/router/head dependency instances during wiring.
 *
 * @example
 * ```ts
 * const ctx: ApiContext = { require: (plugin) => app[plugin.name] };
 * ```
 */
interface ApiContext {
  /** Resolves a dependency plugin instance to its public API. */
  require(plugin: unknown): unknown;
}

/**
 * Creates the `build` plugin API surface — the pipeline driver (`run`) plus
 * `phases` introspection. Pulls the content/router/head dependency instances via
 * `ctx.require` here (keeping `index.ts` wiring-only) and delegates per-phase work
 * to the modules in `phases/`.
 *
 * @param ctx - Plugin context exposing `require` for dependency resolution.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * await api.run({ outDir: "./preview" });
 * ```
 */
export function createApi(ctx: ApiContext): Api {
  ctx.require(contentPlugin);
  ctx.require(routerPlugin);
  ctx.require(headPlugin);
  throw new Error("not implemented");
}

/**
 * Validates `build` config synchronously in `onInit` (return value discarded).
 * Throws an actionable `[web] build.<field>` error when `outDir` is empty, or
 * when `ogImage` is enabled but `fontDir` is missing / has no `.ttf`/`.otf`/`.woff`.
 *
 * @param _config - The resolved `build` config to validate.
 * @example
 * ```ts
 * validateConfig(ctx.config);
 * ```
 */
export function validateConfig(_config: Config): void {
  throw new Error("not implemented");
}
