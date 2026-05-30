/**
 * @file build plugin — type definitions (Config, State, Api, public output types).
 */
import type { EmitFn } from "@moku-labs/core";
import type { RouteDefinition } from "../router/types";

/**
 * Structural extraction of a plugin instance's public API from its `_phantom`
 * carrier (mirrors the kernel's non-exported `ExtractPluginApi`) so the
 * framework's generic `require` is assignable to {@link PhaseContext.require}.
 *
 * @example
 * ```ts
 * type ContentApi = ExtractApi<typeof contentPlugin>;
 * ```
 */
export type ExtractApi<PluginCandidate> = PluginCandidate extends {
  readonly _phantom: { readonly api: infer PluginApi };
}
  ? PluginApi
  : never;

/**
 * Minimal logger slice used by the pipeline and phases (the core `log` API).
 *
 * @example
 * ```ts
 * const log: PhaseLog = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };
 * ```
 */
export type PhaseLog = {
  /** Record an informational event. */
  info(event: string, data?: unknown): void;
  /** Record a debug event. */
  debug(event: string, data?: unknown): void;
  /** Record a warning event. */
  warn(event: string, data?: unknown): void;
  /** Record an error event. */
  error(event: string, data?: unknown): void;
};

/**
 * Payload map for the events `build` emits, used to type the `emit` closure
 * handed to the pipeline driver and phases.
 *
 * @example
 * ```ts
 * const emit: PhaseEmit = (name, payload) => kernel.emit(name, payload);
 * ```
 */
export type BuildEvents = {
  /** Phase boundary marker (start, then done with durationMs). */
  "build:phase": { phase: PhaseName; status: "start" | "done"; durationMs?: number };
  /** One successful-run summary. */
  "build:complete": { outDir: string; pageCount: number; durationMs: number };
};

/** Strictly-typed emit closure for the build events (kernel overload form). */
export type PhaseEmit = EmitFn<BuildEvents>;

/** Generic `require` closure for pulling dependency plugin APIs at run time. */
export type PhaseRequire = <
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

/**
 * The plugin-context slice the pipeline driver and every phase consume: the
 * mutable `state`, the resolved `config`/`global`, plus `require`/`emit`/`log`.
 * Typed to match the kernel's generic context so the framework execution
 * context is structurally assignable.
 *
 * @example
 * ```ts
 * const ctx: PhaseContext = { state, config, global, require, emit, log };
 * ```
 */
export type PhaseContext = {
  /** Mutable per-run build state (caches + runId). */
  state: State;
  /** Resolved, frozen build config. */
  readonly config: Readonly<Config>;
  /** Global framework config (mode, etc.). */
  readonly global: Readonly<{ mode: "production" | "development" }>;
  /** Resolve a depended-upon plugin instance to its public API. */
  require: PhaseRequire;
  /** Emit a build event (notification-only). */
  emit: PhaseEmit;
  /** Structured logger (core `log` API). */
  readonly log: PhaseLog;
};

/**
 * Injectable PNG renderer for the og-images phase. Defaults to the real
 * Satori → resvg pipeline; unit tests inject a fake to assert hash-cache skip
 * and the `p-limit` bound without rasterizing real images.
 *
 * @example
 * ```ts
 * const render: OgPngRenderer = async () => new Uint8Array();
 * ```
 */
export type OgPngRenderer = (input: {
  /** Article title rendered into the card. */
  title: string;
  /** Output width in pixels. */
  width: number;
  /** Output height in pixels. */
  height: number;
}) => Promise<Uint8Array>;

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
