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
  /** Whether a plugin is registered (by name) — used to detect the OPTIONAL `data` plugin. */
  has: (name: string) => boolean;
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
export type OgPngRenderer = (input: RichOgInput) => Promise<Uint8Array>;

/**
 * Rich input handed to a custom OG `render` hook for a single article card. Carries
 * the full article + site metadata so a consumer can compose any layout. Returned by
 * the framework, not authored by consumers directly.
 *
 * @example
 * ```ts
 * const input: RichOgInput = {
 *   title: "Hello", description: "Intro", date: "2026-01-15", tags: ["a"],
 *   locale: "en", siteName: "Blog", size: { width: 1200, height: 630 }
 * };
 * ```
 */
export interface RichOgInput {
  /** Article title rendered into the card. */
  title: string;
  /** Article description / summary. */
  description: string;
  /** Publication date (ISO string from frontmatter). */
  date: string;
  /** Article tags. */
  tags: string[];
  /** Optional author name. */
  author?: string;
  /** Active locale for the card. */
  locale: string;
  /** Site name (from the site plugin / config). */
  siteName: string;
  /** Output dimensions for the card. */
  size: { width: number; height: number };
}

/**
 * A single custom OG font entry. Each `path` is read to a Buffer ONCE per build and
 * handed to Satori. `weight`/`style` default to `400`/`"normal"` when omitted.
 *
 * @example
 * ```ts
 * const font: OgFont = { name: "Inter", path: "./fonts/Inter.ttf", weight: 600 };
 * ```
 */
export interface OgFont {
  /** Font family name referenced by the rendered card. */
  name: string;
  /** Path to the .ttf/.otf/.woff file. */
  path: string;
  /** Numeric weight (defaults to 400). */
  weight?: number;
  /** Font style (defaults to "normal"). */
  style?: "normal" | "italic";
}

/**
 * Optional OG-image generation config. Omit the field (or set `false`) to disable.
 *
 * The optional `render` hook (`@jsxImportSource preact`) lets a consumer return a
 * Preact `VNode` for the card; the framework casts it to Satori's input at the single
 * render boundary. `fonts` supplies multiple named fonts loaded once per build.
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
  /** Custom card renderer; returns a Preact `VNode` from the {@link RichOgInput}. */
  render?(input: RichOgInput): import("preact").VNode;
  /** Explicit named fonts loaded once per build (overrides the first-file scan). */
  fonts?: OgFont[];
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
  /** Auto-inject bundled `main.{css,js}` into rendered pages. Default `true`. */
  injectAssets?: boolean;
  /** Directory copied verbatim into `outDir` (skipped silently if absent). Default `"public"`. */
  publicDir?: string;
  /**
   * Emit `outDir/404.html`. `true` for the built-in default page, or
   * `{ route }` to supply the page's literal HTML body content (NOT a route
   * path/slug — the string is written into the 404 page verbatim). Default `false`.
   */
  notFound?: boolean | { route?: string };
  /** Emit per-path i18n bare-path redirect HTML pages. Default `false`. */
  localeRedirects?: boolean;
  /** Authoritative client bundle entry path (overrides the conventional scan). */
  clientEntry?: string;
  /** HTML shell template with `<!--moku:head-->`/`<!--moku:body-->`/`<!--moku:assets-->` placeholders. */
  template?: string;
};

/**
 * A typed asset-manifest entry for one bundled asset kind (CSS or JS): a map of the
 * original entry basename to its hashed on-disk output path. Replaces the untyped
 * `Map<string, unknown>` reads when emitting `<link>`/`<script>` tags in pages.tsx.
 *
 * @example
 * ```ts
 * const entry: BuildCacheEntry = { "main.css": "assets/main-abc123.css" };
 * ```
 */
export type BuildCacheEntry = Record<string, string>;

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
  | "content-images"
  | "feeds"
  | "sitemap"
  | "og-images"
  | "public"
  | "not-found"
  | "locale-redirects"
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
