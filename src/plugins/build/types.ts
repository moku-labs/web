/**
 * @file build plugin — type definitions (Config, State, Api, public output types).
 */
import type { RouteDefinition } from "../router/types";

/**
 * Optional OG-image generation config. Omit the field (or set `false`) to disable.
 *
 * @example
 * ```ts
 * const og: OgImageConfig = { fontDir: "./fonts" };
 * ```
 */
export interface OgImageConfig {
  /** Directory containing at least one .ttf/.otf/.woff font. Validated in onInit (void — config check only). */
  fontDir: string;
  /** Optional path to a custom OG template module. Falls back to the built-in template. */
  template?: string;
  /** Output dimensions. Defaults to 1200x630. */
  size?: { width: number; height: number };
}

/**
 * Public configuration for the `build` plugin. Flags give opt-in granularity over
 * individual outputs without rewriting the pipeline.
 *
 * @example
 * ```ts
 * const config: Config = { outDir: "./dist", minify: true, feeds: true, sitemap: true, images: true, ogImage: false };
 * ```
 */
export type Config = {
  /** Output directory for the built site. */
  outDir: string;
  /** Minify bundled CSS/JS. */
  minify: boolean;
  /** Generate RSS/Atom/JSON feeds. */
  feeds: boolean;
  /** Generate sitemap.xml + robots.txt. */
  sitemap: boolean;
  /** Optimize + copy content images. */
  images: boolean;
  /** OG-image generation. `false` (or omitted) disables it; an object enables and configures it. */
  ogImage: OgImageConfig | false;
};

/**
 * Per-run closure state for the `build` plugin. Holds caches and config only —
 * no domain data is duplicated here (pulled fresh via `ctx.require` each run).
 *
 * @example
 * ```ts
 * const state: State = { config, manifest: null, buildCache: new Map(), runId: null, ogImageHashCache: new Map() };
 * ```
 */
export interface State {
  /** Resolved, frozen config snapshot. */
  config: Config;
  /** Cached route manifest for the current run (populated in Phase 3 from router). */
  manifest: RouteDefinition[] | null;
  /** Per-run build artifacts (e.g. hashed CSS/JS asset paths from Phase 1). */
  buildCache: Map<string, unknown>;
  /** Unique id for the current run (timestamp/uuid) — injected as build-id meta. */
  runId: string | null;
  /**
   * Content-hash cache for OG images: slug -> sha256(title + template + size).
   * Loaded from `<outDir>/.cache/og-images.json` at the OG phase and written back,
   * so unchanged articles are skipped on the next run.
   */
  ogImageHashCache: Map<string, string>;
}

/**
 * Ordered names of the build pipeline phases, in execution order.
 *
 * @example
 * ```ts
 * const phase: PhaseName = "bundle";
 * ```
 */
export type PhaseName =
  | "bundle"
  | "content"
  | "images"
  | "pages"
  | "feeds"
  | "sitemap"
  | "og-images"
  | "root-index";

/**
 * Result of a completed build run.
 *
 * @example
 * ```ts
 * const result: BuildResult = { outDir: "./dist", pageCount: 12, durationMs: 840 };
 * ```
 */
export interface BuildResult {
  /** Resolved output directory the site was written to. */
  outDir: string;
  /** Number of route pages rendered. */
  pageCount: number;
  /** Total wall-clock duration of the run, in milliseconds. */
  durationMs: number;
}

/**
 * Public API surface mounted on `app.build`.
 *
 * @example
 * ```ts
 * const result = await app.build.run();
 * ```
 */
export type Api = {
  /**
   * Run the full SSG pipeline and write the site to disk.
   *
   * @param options - Optional run overrides.
   * @param options.outDir - Override the configured output directory for this run.
   * @returns The build result (outDir, pageCount, durationMs).
   * @example
   * ```ts
   * const result = await app.build.run({ outDir: "./preview" });
   * ```
   */
  run(options?: { outDir?: string }): Promise<BuildResult>;

  /**
   * List the phases in execution order (introspection / tooling).
   *
   * @returns The static ordered phase names.
   * @example
   * ```ts
   * const order = app.build.phases();
   * ```
   */
  phases(): PhaseName[];
};
