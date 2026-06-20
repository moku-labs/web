/**
 * @file build plugin — type definitions (Config, State, Api, public output types).
 */
import type { EmitFn } from "@moku-labs/core";
import type { Stage } from "../../config";
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
  /** Global framework config (deployment stage; render mode is read via `router.mode()`). */
  readonly global: Readonly<{ stage: Stage }>;
  /** Resolve a depended-upon plugin instance to its public API. */
  require: PhaseRequire;
  /** Whether a plugin is registered (by name) — used to detect OPTIONAL plugins (`data`, `content`, `i18n`, `head`). */
  has: (name: string) => boolean;
  /** Emit a build event (notification-only). */
  emit: PhaseEmit;
  /** Structured logger (core `log` API). */
  readonly log: PhaseLog;
};

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
  /**
   * Also render a single SITE-LEVEL default card to `<outDir>/og-default.png`, used (via
   * `head.defaultOgImage: "/og-default.png"`) as the og:image fallback for non-article pages.
   * Rendered ONCE with the same loaded fonts; the per-article `render` hook is NOT applied.
   *
   * - `true` → the built-in generic card (site name over its description on a dark background).
   * - a render function → your OWN card, e.g. `defaultCard: MySiteCard` (a `(input) => VNode`,
   *   the same shape as `render`); `input.siteName`/`input.description` carry the site identity.
   * - `false`/omitted → no card (default).
   */
  defaultCard?: boolean | ((input: RichOgInput) => import("preact").VNode);
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
   * Emit `outDir/404.html`. One of:
   * - `true` — the built-in default page.
   * - `{ body }` — literal HTML body content, wrapped in a minimal document shell.
   * - `{ path }` — path to a complete HTML page file (resolved from the project
   *   root) so the app owns the whole document (its own `<head>`, asset links,
   *   and body).
   *
   * In every variant the `<!--moku:assets-->` / `<!--moku:assets:css-->` /
   * `<!--moku:assets:js-->` placeholders are substituted with the fingerprinted
   * bundle tags (bundle filenames embed a content hash, so a 404 page cannot
   * hardcode them); a page without placeholders is written byte-for-byte.
   *
   * `path` takes precedence over `body` when both are set. Default `false`.
   */
  notFound?: boolean | { body?: string; path?: string };
  /** Emit per-path i18n bare-path redirect HTML pages. Default `false`. */
  localeRedirects?: boolean;
  /** Authoritative client bundle entry path (overrides the conventional scan). */
  clientEntry?: string;
  /**
   * Path to a custom HTML document shell, giving the app full control over the
   * scaffold (charset, viewport, `<html lang>`, body attributes, wrapper markup).
   * Placeholders, substituted per page at build time:
   * `<!--moku:lang-->` (page locale for `<html lang>`),
   * `<!--moku:head-->` (composed `<head>` inner HTML),
   * `<!--moku:assets-->` (injected `<link>`/`<script>` tags),
   * `<!--moku:assets:css-->` / `<!--moku:assets:js-->` (one asset kind each, for
   * shells that link stylesheets in `<head>` but script tags elsewhere),
   * `<!--moku:body-->` (SSR body HTML).
   * When unset, the built-in shell is used (it emits charset + viewport by default).
   */
  template?: string;

  /**
   * Emit `outDir/_headers` (Cloudflare Pages header rules) for CDN/browser cache
   * protection. Generated rules: every fingerprinted bundle output gets a
   * per-file `Cache-Control: <assets>` rule (default immutable, 1 year — its URL
   * embeds a content hash, so the bytes behind it can never change), and every
   * other URL — pages, content images, feeds, data sidecars: stable URLs whose
   * bytes MAY change between deploys — gets the catch-all
   * `Cache-Control: <pages>` rule (default always-revalidate: unchanged files
   * still answer `304 Not Modified` from their ETag, changed files are picked up
   * immediately). The app's own `<publicDir>/_headers` content is appended AFTER
   * the generated rules so the app can override them (detach a generated header
   * first with `! Cache-Control` — Cloudflare comma-joins duplicate headers).
   * `false` disables the phase; an object overrides one or both values.
   * Default `true`.
   */
  cacheHeaders?: boolean | { assets?: string; pages?: string };
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
 * One cached page render: the SSR body HTML keyed by a hash of the inputs that determine
 * it (the route's loaded data). Lets a dev incremental rebuild skip the synchronous,
 * dominant-cost `preact-render-to-string` for a page whose data is unchanged.
 *
 * @example
 * ```ts
 * const entry: RenderCacheEntry = { dataHash: "9f8e…", body: "<h1>Hi</h1>" };
 * ```
 */
export type RenderCacheEntry = {
  /** Hash of the page's render inputs (its loaded data). */
  dataHash: string;
  /** The SSR-rendered body HTML for those inputs. */
  body: string;
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
  /**
   * Cross-run page-render cache: `name\0params\0locale` -> {@link RenderCacheEntry}.
   * Persists across dev rebuilds (never reset by a run) so an incremental rebuild reuses
   * the body of any page whose data is unchanged. Empty for a fresh process; cleared by a
   * full (non-incremental) render so stale entries for removed routes never linger.
   */
  renderCache: Map<string, RenderCacheEntry>;
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
  | "cache-headers"
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
 * Per-run {@link Config} field overrides for a single {@link Api.run} call. Lets a dev
 * rebuild disable expensive, preview-irrelevant outputs (feeds / sitemap / og-images /
 * locale-redirects) and minification WITHOUT mutating the persisted plugin config. Each
 * key maps to the same-named {@link Config} flag and is merged over the config snapshot
 * for that one run only.
 *
 * @example
 * ```ts
 * const dev: BuildRunOverrides = { minify: false, feeds: false, sitemap: false };
 * ```
 */
export type BuildRunOverrides = Readonly<
  Partial<
    Pick<
      Config,
      | "minify"
      | "feeds"
      | "sitemap"
      | "ogImage"
      | "images"
      | "localeRedirects"
      | "notFound"
      | "cacheHeaders"
    >
  >
>;

/**
 * Options for a single {@link Api.run} call. All fields are optional; an absent/empty
 * options object runs the full production build (clean + every configured phase). The
 * dev server (`serve()`) passes `skipClean`/`overrides`/`changed` to make a rebuild
 * fast without touching the production path.
 *
 * @example
 * ```ts
 * await app.build.run({ skipClean: true, overrides: { minify: false }, changed: ["/abs/content/intro/en.md"] });
 * ```
 */
export type RunOptions = {
  /** Override the configured output directory for this run. */
  outDir?: string;
  /**
   * Skip the destructive clean (`rm -rf outDir`) so caches + unchanged assets survive a dev
   * rebuild. TRADE-OFF: because nothing is pruned, output for a route DELETED or renamed
   * since the last build lingers on disk (and is still served by the dev server) until the
   * next full/clean build — restart `serve` or run a production `build` to clear it.
   */
  skipClean?: boolean;
  /** Per-run {@link Config} field overrides merged over the snapshot (e.g. disable feeds/sitemap/minify in dev). */
  overrides?: BuildRunOverrides;
  /**
   * Paths changed since the last build (dev incremental rebuild). When present, the pipeline
   * re-reads only changed Markdown and re-renders only pages whose loaded data changed; omit
   * it for a full build (initial build + every production build). CORRECTNESS NOTE: render
   * reuse is sound only when a route's render/layout output is a pure function of its
   * `.load()` data (+ params/locale/code) — a route whose `.render()` reads module-global or
   * other out-of-band state can show a stale body on a content-only rebuild until the next
   * code change or restart. Production builds omit `changed`, so they are never affected.
   */
  changed?: readonly string[];
};

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
   * Run the full SSG pipeline and write the site to disk. With no options a full
   * production build runs (clean + every configured phase); dev callers pass
   * {@link RunOptions} (`skipClean`/`overrides`/`changed`) for a fast incremental rebuild.
   *
   * @param options - Optional per-run overrides ({@link RunOptions}).
   * @returns The build result (outDir, pageCount, durationMs).
   * @example
   * ```ts
   * const result = await app.build.run({ outDir: "./preview" });
   * ```
   */
  run(options?: RunOptions): Promise<BuildResult>;

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
