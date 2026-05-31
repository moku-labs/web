/**
 * @file data plugin — type definitions (Standard tier).
 *
 * The `data` plugin is the isomorphic BRIDGE for the two-world data pattern. It
 * owns the build↔runtime data contract on BOTH sides:
 *  - **Node (build):** `emit()` writes a STABLE route-index manifest + per-route
 *    content-hashed JSON sidecars from the framework's own typed data.
 *  - **Browser (runtime):** `manifest()` / `load(path)` fetch + parse those same
 *    files and hand the route's data to `spa` for JSON-driven navigation.
 *
 * Because one module owns both the write and read ends, the on-disk format cannot
 * drift. The Node-only file-writing code (`node:fs`/`node:crypto`) is isolated
 * behind a lazy `import()` inside `emit()`, so composing `data` in a browser app
 * keeps the bundle free of `node:*`.
 */

/**
 * Configuration for {@link dataPlugin}. All fields have defaults (see `./config`),
 * so the config is optional at `createApp`.
 *
 * @example
 * ```ts
 * const cfg: DataConfig = { outputDir: "_data", baseUrl: "/_data/", payload: "fragment" };
 * ```
 */
export type DataConfig = {
  /**
   * WRITE side (Node) — output root relative to the build `outDir`, a filesystem
   * path where `emit()` writes the manifest + sidecars. Default `"_data"`.
   */
  outputDir: string;
  /**
   * READ side (browser) — site-root-relative URL the client fetches the manifest +
   * sidecars from. A different domain from {@link DataConfig.outputDir} (a
   * filesystem path); keep them consistent (normally `"/" + trim(outputDir) + "/"`).
   * Default `"/_data/"`.
   */
  baseUrl: string;
  /**
   * `"fragment"` = HTML-in-JSON (hybrid: `load()` returns pre-rendered HTML, no
   * client render layer); `"data"` = data-only (pure-SPA: `load()` returns raw
   * data the client renders). Default `"fragment"`.
   */
  payload: "fragment" | "data";
};

/** Summary returned by {@link DataApi.emit} and cached in state. */
export interface EmitSummary {
  /** Path of the written STABLE route-index manifest. */
  manifestPath: string;
  /** Number of per-route sidecar files written. */
  sidecarCount: number;
  /** Resolved build output directory the emit wrote under. */
  outDir: string;
}

/**
 * Result of {@link DataApi.load} — a discriminated union the `spa` consume-half
 * switches on. `"fragment"` carries pre-rendered HTML to swap directly; `"data"`
 * carries raw data the client renders.
 */
export type RouteData =
  | {
      /** Hybrid payload: swap `html` into the region, no client render. */
      kind: "fragment";
      /** SSR HTML fragment for the swap region. */
      html: string;
      /** Route metadata projected for the client. */
      meta: Record<string, unknown>;
    }
  | {
      /** Pure-SPA payload: client renders from `data`. */
      kind: "data";
      /** Serializable route data (e.g. an Article projection). */
      data: unknown;
      /** Route metadata projected for the client. */
      meta: Record<string, unknown>;
    };

/**
 * Internal data state. `lastEmit` records the most recent `emit()` (Node);
 * `manifest` caches the fetched route-index (browser, lazy). Both `null` until
 * their respective side first runs.
 */
export interface DataState {
  /** Result of the last `emit()`, or `null` if it has not run yet (Node). */
  lastEmit: EmitSummary | null;
  /** Lazily-fetched route-index, cached after the first `load()`/`manifest()` (browser). */
  manifest: RouteIndexFile | null;
}

/**
 * Public API mounted at `app.data` — the isomorphic bridge. `emit()` is the Node
 * write side; `manifest()`/`load()` are the browser read side. Composing `data`
 * never forces either side: a Node build calls `emit()`, a browser app calls
 * `load()`, and unused code paths stay out of the respective bundle.
 *
 * @example
 * ```ts
 * // Node build:
 * await app.build.run();
 * await app.data.emit();
 *
 * // Browser (inside spa nav): fetch the route's data through the bridge:
 * const routeData = await app.data.load("/blog/hello/");
 * ```
 */
export type DataApi = {
  /**
   * WRITE (Node) — emit the route-index manifest + per-route sidecars. AWAITED;
   * call after `await app.build.run()` so the on-disk SSR fragments exist. Lazily
   * loads its `node:fs` writer and `require`s `router`/`content` at call time, so
   * it never contaminates a browser bundle. Throws `[web]` if those plugins are
   * absent (i.e. not a Node build).
   *
   * @param options - Optional overrides.
   * @param options.outDir - Build output directory the emit writes under.
   * @returns A summary of the emitted manifest path, sidecar count, and outDir.
   */
  emit(options?: { outDir?: string }): Promise<EmitSummary>;
  /**
   * READ (browser) — fetch (and cache) the STABLE route-index manifest from
   * `config.baseUrl`. Returns `null` if it cannot be fetched/parsed.
   *
   * @returns The parsed route-index, or `null` on failure.
   */
  manifest(): Promise<RouteIndexFile | null>;
  /**
   * READ (browser) — resolve `path` against the manifest, fetch the matching
   * route's content-hashed sidecar, and return its {@link RouteData}. Returns
   * `null` when there is no match or the fetch/parse fails (the caller — `spa` —
   * then falls back to HTML-over-fetch).
   *
   * @param path - The pathname (optionally with search) to resolve.
   * @returns The route's data, or `null` to signal "fall back".
   */
  load(path: string): Promise<RouteData | null>;
};

/**
 * Shape of the STABLE `routes-manifest.json` route-index. Un-hashed filename
 * (short cache); each `dataUrl` points at a content-hashed sidecar (long cache).
 */
export interface RouteIndexFile {
  /** Build identifier, used for client-side cache busting. */
  buildId: string;
  /** Serializable route entries, each pointing at its hashed sidecar URL. */
  routes: ReadonlyArray<{
    pattern: string;
    name: string;
    meta: Record<string, unknown>;
    dataUrl: string;
  }>;
}

/** `"fragment"` sidecar payload — pre-rendered SSR HTML for the swap region. */
export interface SidecarFragment {
  /** SSR HTML fragment for the swap region (reused, never re-rendered). */
  html: string;
  /** Route metadata projected for the client. */
  meta: Record<string, unknown>;
}

/** `"data"` sidecar payload — data-only projection for pure-SPA client render. */
export interface SidecarData {
  /** Serializable route data (e.g. an Article projection). */
  data: unknown;
  /** Route metadata projected for the client. */
  meta: Record<string, unknown>;
}
