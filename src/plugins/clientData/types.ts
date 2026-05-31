/**
 * @file clientData plugin — type definitions (Standard tier).
 *
 * Build-emit half of the two-world data pattern: a STABLE route-index manifest
 * plus per-route content-hashed JSON sidecars, written from the framework's own
 * typed data so the SPA consume-half can perform JSON-driven navigation.
 */

/**
 * Configuration for {@link clientDataPlugin}. Both fields have defaults (see
 * `./config`), so the config is optional at `createApp`.
 *
 * @example
 * ```ts
 * const cfg: ClientDataConfig = { outputDir: "_data", payload: "fragment" };
 * ```
 */
export type ClientDataConfig = {
  /** Output root relative to the build `outDir`. Default `"_data"`. */
  outputDir: string;
  /**
   * `"fragment"` = HTML-in-JSON (hybrid, no client render layer); `"data"` =
   * data-only (pure-SPA). Default `"fragment"`.
   */
  payload: "fragment" | "data";
};

/** Summary returned by {@link ClientDataApi.emit} and cached in state. */
export interface EmitSummary {
  /** Path of the written STABLE route-index manifest. */
  manifestPath: string;
  /** Number of per-route sidecar files written. */
  sidecarCount: number;
  /** Resolved build output directory the emit wrote under. */
  outDir: string;
}

/**
 * Internal clientData state: the most recent emit summary, or `null` before the
 * first {@link ClientDataApi.emit} call.
 */
export interface ClientDataState {
  /** Result of the last `emit()`, or `null` if it has not run yet. */
  lastEmit: EmitSummary | null;
}

/**
 * Public API mounted at `ctx.clientData`. A single awaited `emit()` method —
 * Node-only, build-time.
 *
 * @example
 * ```ts
 * await app.build.run();
 * await app.clientData.emit();
 * ```
 */
export type ClientDataApi = {
  /**
   * Emit the route-index manifest + per-route sidecars. AWAITED — call after
   * `await app.build.run()` so the on-disk SSR fragments exist.
   *
   * @param options - Optional overrides.
   * @param options.outDir - Build output directory the emit writes under.
   * @returns A summary of the emitted manifest path, sidecar count, and outDir.
   */
  emit(options?: { outDir?: string }): Promise<EmitSummary>;
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
}
