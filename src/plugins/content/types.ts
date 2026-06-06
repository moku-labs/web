/**
 * @file content plugin — type definitions skeleton.
 *
 * Provider-driven, like `env`: the SHELL (browser-safe) owns orchestration — locale
 * fallback, draft filtering, date sort, the article cache, and events — while a
 * {@link ContentProvider} owns source I/O + the Markdown pipeline. Compose the node
 * {@link FileSystemContentOptions}-configured `fileSystemContent` provider for a build;
 * the shell itself imports zero node code, so `contentPlugin` is browser-safe.
 */
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
 * { articles: new Map() }
 * ```
 */
export type State = {
  /** Article cache keyed locale -> (slug -> Article). Starts empty. */
  articles: Map<string, Map<string, Article>>;
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
   * Reuse already-cached articles for slugs NOT dropped by a preceding `invalidate()`,
   * re-reading + re-rendering (Shiki) ONLY the invalidated (dirty) articles. The
   * post-sort `contentId` ordinals are always recomputed across the full set, so order +
   * ids match a full load. Default `false` (a full load that re-reads every article).
   * Used by dev incremental rebuilds; a fresh process / production build never reuses.
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
   * Load every article across every active locale, returning a locale-keyed
   * map of date-descending Article arrays. Emits content:ready.
   *
   * @param options - Optional load behaviour ({@link LoadAllOptions}); omit for a full load.
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
