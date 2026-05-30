/**
 * @file deploy plugin — API factory.
 */
import type { Api } from "./types";

/**
 * Creates the deploy plugin API surface (run, getLastDeployment, init).
 *
 * @param _ctx - Plugin context (unused in skeleton).
 * @example
 * ```ts
 * const api = createApi(ctx);
 * ```
 */
export function createApi(_ctx: unknown): Api {
  throw new Error("not implemented");
}

/**
 * Validate the resolved deploy config during onInit (config-only, no resource
 * allocation). Throws ERR_DEPLOY_CONFIG on a bad target/outDir/etc.
 *
 * @param _ctx - Plugin context exposing the resolved config (unused in skeleton).
 * @example
 * ```ts
 * createPlugin("deploy", { onInit: validateConfig });
 * ```
 */
export function validateConfig(_ctx: unknown): void {
  // validateConfig(_ctx.config) — ERR_DEPLOY_CONFIG on bad target/outDir/etc (build).
}
