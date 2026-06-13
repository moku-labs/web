/**
 * @file content plugin — type definitions skeleton.
 *
 * Provider-driven, like `env`: the SHELL (browser-safe) owns orchestration — locale
 * fallback, draft filtering, date sort, the article cache, and events — while a
 * {@link ContentProvider} owns source I/O + the Markdown pipeline. Compose the node
 * {@link FileSystemContentOptions}-configured `fileSystemContent` provider for a build;
 * the shell itself imports zero node code, so `contentPlugin` is browser-safe.
 */
import type { FunctionComponent } from "preact";
import type { BundledTheme, ThemeRegistrationAny } from "shiki";
import type { Pluggable, Processor } from "unified";
import type { Stage } from "../../config";

/**
 * YAML frontmatter parsed from each article file.
 *
 * @example
 * ```ts
 * { title: "Hello", date: "2026-01-15", description: "Intro", tags: [], language: "en" }
 * ```
 */
export type Frontmatter = {
  /** Article title. Required. */
  title: string;
  /** ISO 8601 date string, e.g. "2026-01-15". Required. */
  date: string;
  /** Short summary used in cards, feeds, and meta description. Required. */
  description: string;
  /** Topic tags. Required (may be empty array). */
  tags: string[];
  /** Source language code of this file. Required. */
  language: string;
  /** Draft flag. Excluded from output in production mode. Defaults to false. */
  draft?: boolean;
  /** Author name. Falls back to the provider's defaultAuthor when omitted. */
  author?: string;
};

/**
 * Fields computed by the pipeline (not authored in frontmatter).
 *
 * @example
 * ```ts
 * { slug: "hello", readingTime: 1, contentId: "hello", status: "published", wordCount: 42 }
 * ```
 */
export type ComputedFields = {
  /** Article directory name. */
  slug: string;
  /** Reading time in minutes (ceiling, minimum 1). */
  readingTime: number;
  /** Stable content identifier (slug by default). */
  contentId: string;
  /** Derived publication status. */
  status: "published" | "draft";
  /** Word count from the source body. */
  wordCount: number;
};

/**
 * A fully processed, render-ready article.
 *
 * @example
 * ```ts
 * { frontmatter, computed, html: "<p>…</p>", locale: "en", isFallback: false, url: "/en/hello/" }
 * ```
 */
export type Article = {
  /** Parsed frontmatter. */
  frontmatter: Frontmatter;
  /** Pipeline-computed metadata. */
  computed: ComputedFields;
  /** Sanitized rendered HTML body. */
  html: string;
  /** Locale this Article instance represents (the requested locale, even on fallback). */
  locale: string;
  /** True when the default-locale file was used because the requested locale was missing. */
  isFallback: boolean;
  /** Canonical URL for this article in this locale. */
  url: string;
};

/**
 * Lightweight projection of Article for cards/lists.
 *
 * @example
 * ```ts
 * { contentId: "hello", status: "published", title: "Hello", date: "2026-01-15", description: "Intro", tags: [], readingTime: 1, url: "/en/hello/" }
 * ```
 */
export type ArticleCard = {
  /** Stable content identifier. */
  contentId: string;
  /** Derived publication status. */
  status: "published" | "draft";
  /** Article title. */
  title: string;
  /** ISO 8601 date string. */
  date: string;
  /** Short summary. */
  description: string;
  /** Topic tags. */
  tags: string[];
  /** Reading time in minutes. */
  readingTime: number;
  /** Canonical URL for this article in this locale. */
  url: string;
};

/**
 * A pluggable content SOURCE. The shell calls these to read articles; whether content
 * is read from the filesystem (Node) or some other source is chosen by which provider
 * you compose — exactly like `env` providers (`dotenv`/`processEnv` vs `browserEnv`).
 * The shell adds locale fallback, draft filtering, sorting, caching, and events on top.
 *
 * @example
 * ```ts
 * const provider = fileSystemContent({ contentDir: "./content" });
 * ```
 */
export interface ContentProvider {
  /** Human-readable provider name, used in diagnostics. */
  readonly name: string;
  /** Source directory surfaced via `api.contentDir()` (filesystem providers; "" otherwise). */
  readonly contentDir: string;
  /**
   * Discover the article slugs this provider can supply.
   *
   * @returns The provider's slug list.
   */
  slugs(): Promise<readonly string[]>;
  /**
   * Read + render ONE article for a file-locale; `null` if this provider has no such file.
   *
   * @param slug - Article directory name.
   * @param fileLocale - Locale whose source file is read.
   * @param outLocale - Locale the resulting Article represents (the requested locale).
   * @param isFallback - Whether this resolution used the default-locale fallback.
   * @returns The constructed Article, or `null` when absent.
   */
  readArticle(
    slug: string,
    fileLocale: string,
    outLocale: string,
    isFallback: boolean
  ): Promise<Article | null>;
  /**
   * Render a standalone Markdown string to HTML through the provider's pipeline.
   *
   * @param markdown - Raw Markdown source.
   * @returns The rendered HTML.
   */
  render(markdown: string): Promise<string>;
  /**
   * Optional dev hook: drop cached discovery so stale paths are re-read next time.
   *
   * @param paths - Stale file paths.
   */
  invalidate?(paths: readonly string[]): void;
}

/**
 * Options for build-time Mermaid diagram rendering (the `mermaid` key of
 * {@link FileSystemContentOptions}). Rendering is delegated to the OPTIONAL
 * peer dependency `mermaid-isomorphic`, so the config stays loosely typed —
 * its types are never imported here.
 *
 * @example
 * ```ts
 * fileSystemContent({ contentDir: "./content", trustedContent: true, mermaid: { mermaidConfig: { theme: "dark" } } });
 * ```
 */
export type MermaidDiagramOptions = {
  /**
   * Mermaid configuration passed straight through to mermaid-isomorphic's
   * render call (e.g. `{ theme: "dark" }`). Loosely typed as a plain record
   * because the dependency is optional.
   */
  mermaidConfig?: Record<string, unknown>;
  /**
   * TEST-ONLY seam: replaces the real mermaid-isomorphic batch renderer so
   * unit tests stay deterministic with no headless browser. Receives every
   * mermaid fence source of one document in order and must resolve to exactly
   * one SVG string per source. Never set this in an app.
   *
   * @param sources - Every mermaid fence source of one document, in order.
   * @param mermaidConfig - The configured mermaid pass-through config, if any.
   * @returns One SVG string per source, in order.
   */
  renderDiagrams?: (
    sources: readonly string[],
    mermaidConfig?: Record<string, unknown>
  ) => Promise<readonly string[]>;
};

/**
 * Props handed to an `::embed` facade component (the click-to-activate placeholder
 * the framework renders to static markup at build time). `width`/`height` are the
 * parsed pixel dimensions when the directive set them; `attributes` is the full raw
 * directive attribute bag, so a custom facade can read arbitrary extra options
 * (e.g. `::embed{… poster="/p.jpg" label="Play"}`).
 *
 * @example
 * ```tsx
 * const Facade = ({ title, attributes }: EmbedFacadeProps) => (
 *   <button type="button" class="lazy-embed-button">
 *     {attributes.poster ? <img src={attributes.poster} alt="" /> : null}
 *     <span class="lazy-embed-title">{title}</span>
 *   </button>
 * );
 * ```
 */
export type EmbedFacadeProps = {
  /** The embed target exactly as written in the directive (the provider resolves it later). */
  src: string;
  /** The human-readable embed title (default label + iframe title). */
  title: string;
  /** Reserved-box width in pixels, when the directive set `width`/`height`. */
  width?: number;
  /** Reserved-box height in pixels, when the directive set `width`/`height`. */
  height?: number;
  /** The full raw directive attribute bag (custom options live here). */
  attributes: Readonly<Record<string, string>>;
};

/**
 * A consumer-supplied facade component: a Preact function component over
 * {@link EmbedFacadeProps}, rendered (at build time, to static markup) as the
 * facade's inner content — inside the framework-owned `<figure>` that carries the
 * island hooks + reserved-box sizing. Defaults to the built-in `EmbedFacadeButton`.
 */
export type EmbedFacade = FunctionComponent<EmbedFacadeProps>;

/**
 * Options for the `::embed` lazy-iframe feature (the `embed` key of
 * {@link FileSystemContentOptions}). `embed: true` uses the default facade;
 * `embed: { facade }` swaps in a consumer Preact component for the placeholder.
 *
 * @example
 * ```ts
 * fileSystemContent({ contentDir: "./content", trustedContent: true, embed: { facade: MyFacade } });
 * ```
 */
export type EmbedOptions = {
  /**
   * Consumer Preact component rendering the facade's inner content (SSR'd to
   * static markup at build — no client JS). Receives {@link EmbedFacadeProps}.
   * Defaults to the built-in `EmbedFacadeButton`.
   */
  facade?: EmbedFacade;
};

/** One resolved gallery slide handed to a {@link GalleryComponent}. */
export type GallerySlide = {
  /** Shared absolute image URL (`/<slug>/<dir>/<file>`), identical from every locale page. */
  src: string;
  /** Per-slide alt text (the directive `caption` with a ` · N` index suffix, or just `N`). */
  alt: string;
};

/**
 * Props handed to a `::gallery` component (the swipeable image set the framework
 * renders to static markup at build time). The framework resolves the directive's
 * `src` folder to the sorted, URL-rewritten {@link GallerySlide} list; `caption` is
 * the directive's `caption` attribute; `attributes` is the full raw directive
 * attribute bag, so a custom component can read arbitrary extra options
 * (e.g. `::gallery{… layout="dots"}`).
 *
 * @example
 * ```tsx
 * const Gallery = ({ slides, caption }: GalleryProps) => (
 *   <div class="gallery-track">
 *     {slides.map(s => <img src={s.src} alt={s.alt} />)}
 *   </div>
 * );
 * ```
 */
export type GalleryProps = {
  /** The resolved slides, in folder order. */
  slides: readonly GallerySlide[];
  /** The directive's `caption` attribute (empty string when unset). */
  caption: string;
  /** The full raw directive attribute bag (custom options live here). */
  attributes: Readonly<Record<string, string>>;
};

/**
 * A consumer-supplied gallery component: a Preact function component over
 * {@link GalleryProps}, rendered (at build time, to static markup) as the inner
 * content — inside the framework-owned `<div data-component="gallery">` that carries
 * the island hook. Defaults to the built-in `GalleryTrack`.
 */
export type GalleryComponent = FunctionComponent<GalleryProps>;

/**
 * Options for the `::gallery` feature (the `gallery` key of
 * {@link FileSystemContentOptions}). `gallery: true` uses the default component;
 * `gallery: { component }` swaps in a consumer Preact component.
 *
 * @example
 * ```ts
 * fileSystemContent({ contentDir: "./content", trustedContent: true, gallery: { component: MyGallery } });
 * ```
 */
export type GalleryOptions = {
  /**
   * Consumer Preact component rendering the gallery's inner content (SSR'd to
   * static markup at build). Receives {@link GalleryProps}. Defaults to the
   * built-in `GalleryTrack`.
   */
  component?: GalleryComponent;
};

/**
 * Resolved gallery transform inputs — {@link GalleryOptions} plus the provider's
 * `contentDir` (needed to read the directive's `src` folder from disk). Assembled
 * by the pipeline wiring; not part of the public config surface.
 */
export type GalleryTransformOptions = GalleryOptions & {
  /** The provider's content directory (folder reads resolve against it). */
  contentDir: string;
};

/**
 * Options for the node filesystem provider {@link ContentProvider} `fileSystemContent`.
 * These are the markdown-pipeline + source concerns that used to live on the content
 * plugin config; they now belong to the provider you compose.
 *
 * @example
 * ```ts
 * fileSystemContent({ contentDir: "./content", shikiTheme: "github-dark", defaultAuthor: "Ada" });
 * ```
 */
export type FileSystemContentOptions = {
  /** Absolute or project-relative path to the content directory. */
  contentDir: string;
  /**
   * SECURITY GATE. When false (the default), rehype-sanitize runs as the final
   * pipeline step. Set true ONLY for fully author-controlled Markdown.
   */
  trustedContent?: boolean;
  /** Additional remark plugins, concatenated AFTER framework defaults. Defaults to []. */
  extraRemarkPlugins?: readonly Pluggable[];
  /** Additional rehype plugins, concatenated after custom transforms, before Shiki + sanitize. Defaults to []. */
  extraRehypePlugins?: readonly Pluggable[];
  /**
   * Shiki theme for syntax highlighting: a bundled theme NAME (default "github-dark")
   * or a custom `ThemeRegistration` object. Passed straight through to `@shikijs/rehype`.
   */
  shikiTheme?: BundledTheme | ThemeRegistrationAny;
  /** Author applied to articles whose frontmatter omits author. Defaults to undefined. */
  defaultAuthor?: string;
  /**
   * Build-time Mermaid diagrams: render fenced `mermaid` code blocks to static
   * inline SVG during the build (zero client-side JS). `true` enables with
   * defaults; an object passes {@link MermaidDiagramOptions}. Requires
   * `trustedContent: true` (the raw inline SVG would be stripped by the
   * sanitize pass) and the OPTIONAL peer dependency `mermaid-isomorphic`
   * (plus playwright with an installed browser). Defaults to disabled.
   */
  mermaid?: boolean | MermaidDiagramOptions;
  /**
   * Lazy iframe embeds: rewrite `::embed{src="…" title="…"}` leaf directives
   * into static click-to-activate facades (no iframe — and none of the target's
   * network/JS cost — until the reader clicks). Pair with the `lazyEmbed` SPA
   * island, which swaps the facade for the real `<iframe loading="lazy">`.
   * `true` enables with the default facade; an object passes {@link EmbedOptions}
   * (e.g. a consumer `facade` Preact component). Requires `trustedContent: true`
   * (the facade is raw HTML the sanitize pass would strip). Defaults to disabled.
   */
  embed?: boolean | EmbedOptions;
  /**
   * Folder galleries: rewrite `::gallery{src="./images/dir/" caption="…"}` leaf
   * directives into a swipeable image set. The framework reads the co-located
   * `src` folder, sorts its images, rewrites each to its shared `/<slug>/…` URL,
   * and renders them through a consumer Preact component (pair it with a gallery
   * SPA island for swipe/keyboard/lightbox). `true` enables with the default
   * component; an object passes {@link GalleryOptions} (e.g. a consumer
   * `component`). Requires `trustedContent: true` (the markup is raw HTML the
   * sanitize pass would strip). Defaults to disabled.
   */
  gallery?: boolean | GalleryOptions;
};

/**
 * Internal mutable state of the filesystem provider: the lazy unified processor and
 * the discovery caches. Owned by the provider closure, never by the plugin shell.
 *
 * @example
 * ```ts
 * { processor: null, slugs: null, dirtyPaths: new Set() }
 * ```
 */
export type ContentProviderState = {
  /** Lazily-created unified processor singleton. null until first render()/readArticle(). */
  processor: Processor | null;
  /** Discovered, sorted slug list cached after first disk scan. null until first discovery. */
  slugs: string[] | null;
  /** Paths marked stale by invalidate(); next discovery re-reads only these. Starts empty. */
  dirtyPaths: Set<string>;
};

/**
 * Configuration for the content plugin (shell).
 *
 * @example
 * ```ts
 * { providers: [fileSystemContent({ contentDir: "./content" })] }
 * ```
 */
export type Config = {
  /**
   * Ordered content sources. Compose at least one (e.g. `fileSystemContent(...)` on
   * Node). The first provider that supplies an article for a slug+locale wins;
   * `slugs()` are unioned. The plugin's own spec default is `[]` (a build must supply one).
   */
  providers: ContentProvider[];
};

/**
 * Internal mutable state for the content plugin shell: the locale-keyed article cache.
 *
 * @example
 * ```ts
 * { articles: new Map(), loadedAll: null }
 * ```
 */
export type State = {
  /** Article cache keyed locale -> (slug -> Article). Starts empty. */
  articles: Map<string, Map<string, Article>>;
  /**
   * Memoized full `loadAll()` result, or `null` when not yet loaded / invalidated. List-route
   * loaders call `loadAll()` once PER PAGE, so without this every page re-reads + re-renders
   * every article (the dev-loop killer). The memo makes repeated calls O(1); `invalidate()`
   * clears it so a dev rebuild reloads (re-resolving only the changed slugs). Starts `null`.
   */
  loadedAll: Map<string, Article[]> | null;
};

/**
 * Notification-only events emitted by the content plugin.
 *
 * @example
 * ```ts
 * emit("content:ready", { locales: ["en"], articleCount: 3 });
 * ```
 */
export type ContentEvents = {
  /** All articles loaded across locales. */
  "content:ready": { locales: readonly string[]; articleCount: number };
  /** Article paths marked stale for dev rebuild. */
  "content:invalidated": { paths: readonly string[] };
};

/**
 * Kernel-free domain context handed to createContentApi by the wiring harness.
 * Carries the shell state (article cache), global flag, emit, the i18n-derived
 * locale helpers, and the resolved content {@link ContentProvider} — so api.ts stays
 * free of createPlugin/ctx AND of any node/pipeline import.
 *
 * @example
 * ```ts
 * const apiContext: ContentApiContext = { state, global, emit, locales, defaultLocale, provider };
 * ```
 */
export type ContentApiContext = {
  /** Mutable shell state (article cache). */
  state: State;
  /** Global framework configuration (deployment stage). */
  global: { stage: Stage };
  /** Emit a registered content event. */
  emit: <K extends keyof ContentEvents>(event: K, payload: ContentEvents[K]) => void;
  /** Active locale codes from i18n. */
  locales: () => readonly string[];
  /** Default locale code from i18n (fallback source). */
  defaultLocale: () => string;
  /** The resolved content source (merged from `config.providers`). */
  provider: ContentProvider;
};

/**
 * Options for {@link Api.loadAll}.
 *
 * @example
 * ```ts
 * await app.content.loadAll({ reuse: true });
 * ```
 */
export type LoadAllOptions = {
  /**
   * Reuse the per-build memo + per-slug cache (re-resolving only slugs a preceding
   * `invalidate()` dropped). Default `true` — this is what keeps repeated `loadAll()` calls
   * (a list route's loader runs once per page) cheap, and makes a dev rebuild re-render only
   * changed articles. Set `false` to force a FRESH full reload (cold build / an
   * unclassifiable change), which re-reads + re-renders every article and rebuilds the memo.
   * The post-sort `contentId` ordinals are always recomputed across the full set, so order +
   * ids match a full load either way.
   */
  reuse?: boolean;
};

/**
 * Public API for the content plugin.
 *
 * @example
 * ```ts
 * const map = await app.content.loadAll();
 * ```
 */
export type Api = {
  /**
   * Load every article across every active locale, returning a locale-keyed map of
   * date-descending Article arrays. Emits content:ready (once per actual load). Cache-first
   * + memoized: repeated calls (e.g. a list route's loader on every page) return the SAME
   * cached result with no re-read — so treat the result as READ-ONLY (do not sort/mutate it
   * in place; slice/copy first). Pass `{ reuse: false }` to force a fresh full reload.
   *
   * @param options - Optional load behaviour ({@link LoadAllOptions}); default reuses the cache.
   */
  loadAll(options?: LoadAllOptions): Promise<Map<string, Article[]>>;
  /**
   * Resolve and render a single article for one locale, with locale fallback.
   *
   * @param slug - Article directory name.
   * @param locale - Requested locale code.
   */
  load(slug: string, locale: string): Promise<Article>;
  /**
   * Render a raw Markdown string to HTML through the full pipeline.
   *
   * @param md - Raw Markdown source.
   */
  renderMarkdown(md: string): Promise<string>;
  /**
   * Mark file paths stale for incremental dev rebuilds. Emits content:invalidated.
   *
   * @param paths - File paths to invalidate.
   */
  invalidate(paths: readonly string[]): void;
  /**
   * Project a full Article to a lightweight ArticleCard for list/grid rendering.
   *
   * @param article - The source article.
   */
  articleToCard(article: Article): ArticleCard;
  /**
   * The configured content source directory (e.g. `"./content"`), from the first
   * provider. Lets the build copy each article's co-located assets
   * (`<contentDir>/<slug>/images/`) into the output.
   */
  contentDir(): string;
};
