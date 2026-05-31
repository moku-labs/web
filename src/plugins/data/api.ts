/**
 * @file data plugin — API factory (emit-half of the two-world pattern).
 */
import type { DataApi, DataConfig, DataState, EmitSummary } from "./types";

/**
 * Minimal structural shape of the plugin context that {@link dataApi}
 * consumes. Typed loosely on purpose so api.ts stays free of the kernel's full
 * plugin-context generic machinery. The emit pipeline (`router.clientManifest()`
 * + `content.loadAll()` → manifest + hashed sidecars) is wired in build wave 3.
 *
 * @example
 * ```ts
 * const api = dataApi(ctx);
 * ```
 */
export type DataPluginContext = {
  /** Mutable plugin state (last emit summary). */
  state: DataState;
  /** Resolved plugin configuration. */
  config: DataConfig;
};

/**
 * Builds the data API. Exposes a single awaited `emit()` method; no
 * `onStart`/`onStop` (one-shot, build-time, holds no resource).
 *
 * @param _ctx - The data plugin context.
 * @returns The {@link DataApi} mounted at `ctx.data`.
 * @example
 * ```ts
 * await app.build.run();
 * await app.data.emit();
 * ```
 */
export function dataApi(_ctx: DataPluginContext): DataApi {
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
      throw new Error("data.emit: not implemented (build wave 3)");
    }
  };
}
