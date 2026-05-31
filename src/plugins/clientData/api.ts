/**
 * @file clientData plugin — API factory (emit-half of the two-world pattern).
 */
import type { ClientDataApi, ClientDataConfig, ClientDataState, EmitSummary } from "./types";

/**
 * Minimal structural shape of the plugin context that {@link clientDataApi}
 * consumes. Typed loosely on purpose so api.ts stays free of the kernel's full
 * plugin-context generic machinery. The emit pipeline (`router.clientManifest()`
 * + `content.loadAll()` → manifest + hashed sidecars) is wired in build wave 3.
 *
 * @example
 * ```ts
 * const api = clientDataApi(ctx);
 * ```
 */
export type ClientDataPluginContext = {
  /** Mutable plugin state (last emit summary). */
  state: ClientDataState;
  /** Resolved plugin configuration. */
  config: ClientDataConfig;
};

/**
 * Builds the clientData API. Exposes a single awaited `emit()` method; no
 * `onStart`/`onStop` (one-shot, build-time, holds no resource).
 *
 * @param _ctx - The clientData plugin context.
 * @returns The {@link ClientDataApi} mounted at `ctx.clientData`.
 * @example
 * ```ts
 * await app.build.run();
 * await app.clientData.emit();
 * ```
 */
export function clientDataApi(_ctx: ClientDataPluginContext): ClientDataApi {
  return {
    /**
     * Emits the route-index manifest + per-route sidecars.
     *
     * @param _options - Optional `{ outDir }` override.
     * @param _options.outDir - Build output directory the emit writes under.
     * @throws {Error} Always — the emit pipeline is implemented in build wave 3.
     * @example
     * ```ts
     * await api.emit({ outDir: "dist" });
     * ```
     */
    emit(_options?: { outDir?: string }): Promise<EmitSummary> {
      throw new Error("clientData.emit: not implemented (build wave 3)");
    }
  };
}
