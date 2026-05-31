/**
 * @file data plugin — API factory (the isomorphic bridge surface).
 *
 * Node-free by construction: this module imports only types. The Node write side
 * (`emit()`) lazily `import()`s its `node:fs` writer at call time (wave 3), so a
 * browser bundle that composes `data` for the read side never pulls `node:*`.
 */
import type {
  DataApi,
  DataConfig,
  DataState,
  EmitSummary,
  RouteData,
  RouteIndexFile
} from "./types";

/**
 * Minimal structural shape of the plugin context that {@link dataApi} consumes.
 * Typed loosely on purpose so api.ts stays free of the kernel's full
 * plugin-context generic machinery.
 *
 * @example
 * ```ts
 * const api = dataApi(ctx);
 * ```
 */
export type DataPluginContext = {
  /** Mutable plugin state (last emit summary + cached manifest). */
  state: DataState;
  /** Resolved plugin configuration. */
  config: DataConfig;
};

/**
 * Builds the data API — the isomorphic bridge. `emit()` is the Node write side
 * (wave 3); `manifest()`/`load()` are the browser read side (wave 4). No
 * `onStart`/`onStop` (holds no long-lived resource).
 *
 * @param _ctx - The data plugin context.
 * @returns The {@link DataApi} mounted at `app.data`.
 * @example
 * ```ts
 * const api = dataApi(ctx);
 * await api.emit();          // Node build
 * await api.load("/blog/");  // browser
 * ```
 */
export function dataApi(_ctx: DataPluginContext): DataApi {
  return {
    /**
     * WRITE (Node) — emit the route-index manifest + per-route sidecars.
     *
     * @param _options - Optional `{ outDir }` override.
     * @param _options.outDir - Build output directory the emit writes under.
     * @throws {Error} Always — the emit pipeline (lazy `node:fs` writer +
     *  `router.clientManifest()`/`content.loadAll()`) is implemented in build wave 3.
     * @example
     * ```ts
     * await api.emit({ outDir: "dist" });
     * ```
     */
    emit(_options?: { outDir?: string }): Promise<EmitSummary> {
      throw new Error("data.emit: not implemented (build wave 3)");
    },
    /**
     * READ (browser) — fetch + cache the STABLE route-index manifest. Will return
     * the parsed route-index (or `null` on failure) once implemented.
     *
     * @throws {Error} Always — the read side is implemented in build wave 4.
     * @example
     * ```ts
     * const index = await api.manifest();
     * ```
     */
    manifest(): Promise<RouteIndexFile | null> {
      throw new Error("data.manifest: not implemented (build wave 4)");
    },
    /**
     * READ (browser) — resolve `path` against the manifest and fetch its sidecar.
     * Will return the route's {@link RouteData} (or `null` to signal "fall back")
     * once implemented.
     *
     * @param _path - The pathname to resolve.
     * @throws {Error} Always — the read side is implemented in build wave 4.
     * @example
     * ```ts
     * const routeData = await api.load("/blog/hello/");
     * ```
     */
    load(_path: string): Promise<RouteData | null> {
      throw new Error("data.load: not implemented (build wave 4)");
    }
  };
}
