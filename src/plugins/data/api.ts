/**
 * @file data plugin — API factory (the isomorphic bridge surface).
 *
 * Node-free by construction: this module statically imports only types. The Node
 * write side (`emit()`) reaches its `node:fs`/`node:crypto` writer through a lazy
 * `await import("./emit")` at call time, so a browser bundle that composes `data`
 * for the read side never pulls `node:*`. The read side (`manifest()`/`load()`,
 * wave 4) uses only `fetch` + the browser-safe `../router/iso-match` matcher.
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
 * Extract a plugin's public API type from its phantom marker — mirrors the
 * `head`/`build` convention so `ctx.require(plugin)` is typed without importing
 * the kernel's full plugin-context generic.
 *
 * @example
 * ```ts
 * type RouterApi = ExtractApi<typeof routerPlugin>;
 * ```
 */
export type ExtractApi<PluginCandidate> = PluginCandidate extends {
  readonly _phantom: { readonly api: infer PluginApi };
}
  ? PluginApi
  : never;

/**
 * The plugin-context slice the data API factory consumes: mutable `state`, the
 * resolved `config`, and the generic `require` (used by the Node `emit()` side to
 * resolve `router`/`content` lazily at call time). Typed loosely on purpose so
 * api.ts stays free of the kernel's full plugin-context generic machinery while
 * remaining assignable from the framework execution context.
 *
 * @example
 * ```ts
 * const ctx: DataPluginContext = { state, config, require: plugin => app[plugin.name] };
 * ```
 */
export type DataPluginContext = {
  /** Mutable plugin state (last emit summary + cached manifest). */
  state: DataState;
  /** Resolved plugin configuration. */
  config: DataConfig;
  /** Resolve a registered plugin instance to its public API (Node `emit()` side). */
  require: <
    PluginCandidate extends {
      readonly name: string;
      readonly spec: unknown;
      readonly _phantom: {
        readonly config: unknown;
        readonly state: unknown;
        readonly api: unknown;
        readonly events: Record<string, unknown>;
      };
    }
  >(
    plugin: PluginCandidate
  ) => ExtractApi<PluginCandidate>;
};

/**
 * Builds the data API — the isomorphic bridge. `emit()` is the Node write side
 * (wave 3); `manifest()`/`load()` are the browser read side (wave 4). No
 * `onStart`/`onStop` (holds no long-lived resource).
 *
 * @param ctx - The data plugin context.
 * @returns The {@link DataApi} mounted at `app.data`.
 * @example
 * ```ts
 * const api = dataApi(ctx);
 * await api.emit();          // Node build
 * await api.load("/blog/");  // browser
 * ```
 */
export function dataApi(ctx: DataPluginContext): DataApi {
  return {
    /**
     * WRITE (Node) — emit the route-index manifest + per-route content-hashed
     * sidecars. AWAITED; call after `await app.build.run()` so the on-disk SSR
     * fragments exist. Lazily loads its `node:fs` writer (keeping a browser bundle
     * node-free) and `require`s `router`/`content` at call time.
     *
     * @param options - Optional `{ outDir }` override (defaults to `./dist`).
     * @param options.outDir - Build output directory the emit writes under.
     * @returns A summary of the emitted manifest path, sidecar count, and outDir.
     * @example
     * ```ts
     * await api.emit({ outDir: "dist" });
     * ```
     */
    async emit(options?: { outDir?: string }): Promise<EmitSummary> {
      const { emitData } = await import("./emit");
      return emitData(ctx, options);
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
