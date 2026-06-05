/**
 * @file content plugin — type definitions skeleton.
 */
import type { BundledTheme, ThemeRegistrationAny } from "shiki";
import type { Pluggable, Processor } from "unified";

/**
 * Configuration for the content plugin.
 *
 * @example
 * ```ts
 * { contentDir: "./src/content", trustedContent: false, shikiTheme: "github-dark" }
 * ```
 */
export type Config = {
  /** Absolute or project-relative path to the content directory. Validated in onInit. */
  contentDir: string;
  /**
   * SECURITY GATE. When false (the default), rehype-sanitize runs as the final
   * pipeline step. Set true ONLY for fully author-controlled Markdown — true
   * disables sanitize and trusts all raw HTML.
   */
  trustedContent: boolean;
  /** Additional remark plugins, concatenated AFTER framework defaults. Defaults to []. */
  extraRemarkPlugins?: readonly Pluggable[];
  /** Additional rehype plugins, concatenated after custom transforms, before Shiki + sanitize. Defaults to []. */
  extraRehypePlugins?: readonly Pluggable[];
  /**
   * Shiki theme for syntax highlighting: a bundled theme NAME — typed as Shiki's
   * `BundledTheme` union so editors autocomplete the ~60 built-ins (default
   * "github-dark") — or a custom `ThemeRegistration` object. Passed straight through
   * to `@shikijs/rehype`'s `theme`. (Like Shiki's own theme type, an arbitrary string
   * still compiles via the object arm, so this is autocomplete, not typo-rejection.)
   */
  shikiTheme?: BundledTheme | ThemeRegistrationAny;
  /** Author applied to articles whose frontmatter omits author. Defaults to undefined. */
  defaultAuthor?: string;
};

/**
 * Internal mutable state for the content plugin.
 *
 * @example
 * ```ts
 * { processor: null, articles: new Map(), slugs: null, dirtyPaths: new Set() }
 * ```
 */
export type State = {
  /** Lazily-created unified processor singleton. null until first render()/loadAll(). */
  processor: Processor | null;
  /** Article cache keyed locale -> (slug -> Article). Starts empty. */
  articles: Map<string, Map<string, Article>>;
  /** Discovered, sorted slug list cached after first disk scan. null until first discovery. */
  slugs: string[] | null;
  /** Paths marked stale by invalidate(); next loadAll() re-reads only these. Starts empty. */
  dirtyPaths: Set<string>;
};

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
  /** Author name. Falls back to config.defaultAuthor when omitted. */
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
 * Carries ctx.state (mutable escape hatch), config, global, emit, and the
 * i18n-derived locale/url helpers — so api.ts stays free of createPlugin/ctx.
 *
 * @example
 * ```ts
 * const apiContext: ContentApiContext = { state, config, global, emit, locales, defaultLocale, articleToUrl };
 * ```
 */
export type ContentApiContext = {
  /** Mutable plugin state (article cache + lazy processor). */
  state: State;
  /** Resolved plugin configuration. */
  config: Config;
  /** Global framework configuration (development flag). */
  global: { isDevelopment: boolean };
  /** Emit a registered content event. */
  emit: <K extends keyof ContentEvents>(event: K, payload: ContentEvents[K]) => void;
  /** Active locale codes from i18n. */
  locales: () => readonly string[];
  /** Default locale code from i18n (fallback source). */
  defaultLocale: () => string;
  /** Build a canonical article URL for a locale + slug. */
  articleToUrl: (locale: string, slug: string) => string;
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
   */
  loadAll(): Promise<Map<string, Article[]>>;
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
   * The configured content source directory (e.g. `"./content"`). Lets the build copy each
   * article's co-located assets (`<contentDir>/<slug>/images/`) into the output so the absolute
   * image URLs the renderer emits resolve.
   */
  contentDir(): string;
};
