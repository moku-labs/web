/**
 * @file content plugin — API factory + context-assembly + loader/invalidate logic.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { i18nPlugin } from "../i18n";
import type { Api as I18nApi } from "../i18n/types";
import { parseFrontmatter } from "./pipeline/frontmatter";
import { ensureProcessor } from "./pipeline/markdown";
import { calculateReadingTime } from "./pipeline/reading-time";
import type {
  Api,
  Article,
  ArticleCard,
  Config,
  ContentApiContext,
  ContentEvents,
  State
} from "./types";

/**
 * Minimal structural shape of the plugin context that {@link contentApi}
 * consumes — state, config, global, emit, and the typed `require` accessor used
 * to reach the i18n plugin API. Typed loosely on purpose so api.ts stays free of
 * the kernel's full plugin-context generic machinery.
 *
 * @example
 * ```ts
 * const api = contentApi(ctx);
 * ```
 */
export type ContentPluginContext = {
  /** Mutable plugin state (article cache + lazy processor). */
  state: State;
  /** Resolved plugin configuration. */
  config: Config;
  /** Global framework configuration (mode, etc.). */
  global: { mode: "production" | "development" };
  /** Emit a registered content event. */
  emit: <K extends keyof ContentEvents>(event: K, payload: ContentEvents[K]) => void;
  /** Resolve a depended-upon plugin's API (here the i18n plugin). */
  require: (plugin: typeof i18nPlugin) => I18nApi;
};

/**
 * Build a canonical article URL for a locale + slug.
 *
 * @param locale - Requested locale code.
 * @param slug - Article directory name.
 * @returns The canonical article URL.
 * @example
 * ```ts
 * articleToUrl("en", "hello"); // "/en/hello/"
 * ```
 */
function articleToUrl(locale: string, slug: string): string {
  return `/${locale}/${slug}/`;
}

/**
 * Build the canonical "article not found" error for {@link createContentApi.load}.
 * Centralised so the null-resolve path and the production draft-suppression path
 * throw an IDENTICAL message — drafts must be indistinguishable from missing
 * articles in production (no new error shape).
 *
 * @param slug - Article directory name.
 * @param locale - Requested locale code.
 * @returns The not-found Error to throw.
 * @example
 * ```ts
 * throw articleNotFound("intro", "uk");
 * ```
 */
function articleNotFound(slug: string, locale: string): Error {
  return new Error(
    `[web] content article "${slug}" not found for locale "${locale}".\n` +
      `  Looked for ${slug}/${locale}.md and the default-locale fallback.`
  );
}

/**
 * Plugin `api` factory: assembles the kernel-free {@link ContentApiContext} from
 * the plugin context (resolving i18n via `ctx.require`) and delegates to
 * {@link createContentApi}. Referenced directly as the plugin's `api` so
 * index.ts stays wiring-only.
 *
 * @param ctx - Plugin context (state, config, global, emit, require).
 * @returns The constructed content plugin API surface.
 * @example
 * ```ts
 * const api = contentApi(ctx);
 * ```
 */
export function contentApi(ctx: ContentPluginContext): Api {
  const i18nApi = ctx.require(i18nPlugin);

  /**
   * Active locale codes from i18n.
   *
   * @returns The configured locale list.
   * @example
   * ```ts
   * locales(); // ["en"]
   * ```
   */
  function locales(): readonly string[] {
    return i18nApi.locales();
  }

  /**
   * Default locale code from i18n (fallback source).
   *
   * @returns The configured default locale.
   * @example
   * ```ts
   * defaultLocale(); // "en"
   * ```
   */
  function defaultLocale(): string {
    return i18nApi.defaultLocale();
  }

  const apiContext: ContentApiContext = {
    state: ctx.state,
    config: ctx.config,
    global: ctx.global,
    emit: ctx.emit,
    locales,
    defaultLocale,
    articleToUrl
  };
  return createContentApi(apiContext);
}

/**
 * Discover slug-like subdirectories of the content root (direct children not
 * starting with `.` or `_`), sorted alphabetically for deterministic ordering.
 *
 * @param dir - Content root directory.
 * @returns The sorted slug list.
 * @example
 * ```ts
 * const slugs = await discoverSlugs("./src/content"); // ["about", "intro"]
 * ```
 */
async function discoverSlugs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const slugs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    slugs.push(entry.name);
  }
  return slugs.toSorted();
}

/**
 * Read and render one article file into an Article, or return `null` when the
 * `{locale}.md` file does not exist. Records the read path so invalidation can
 * target it. The returned `contentId` is provisional (the slug); `loadAll`
 * reassigns it after the date-descending sort.
 *
 * @param ctx - Kernel-free domain context.
 * @param slug - Article directory name.
 * @param fileLocale - Locale whose `{locale}.md` file is read from disk.
 * @param outLocale - Locale the resulting Article represents (requested locale).
 * @param isFallback - Whether this Article was resolved via locale fallback.
 * @returns The constructed Article, or `null` when the file is absent.
 * @example
 * ```ts
 * const article = await readArticle(ctx, "intro", "en", "uk", true);
 * ```
 */
async function readArticle(
  ctx: ContentApiContext,
  slug: string,
  fileLocale: string,
  outLocale: string,
  isFallback: boolean
): Promise<Article | null> {
  const filePath = path.join(ctx.config.contentDir, slug, `${fileLocale}.md`);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    // eslint-disable-next-line unicorn/no-null -- readArticle returns `Article | null`; absence is a null miss
    return null;
  }
  ctx.state.dirtyPaths.delete(filePath);

  const { frontmatter, body } = parseFrontmatter(raw, ctx.config);
  const processor = ensureProcessor(ctx.state, ctx.config);
  const html = String(await processor.process(body));
  const { readingTime, wordCount } = calculateReadingTime(body);
  const status: "published" | "draft" = frontmatter.draft ? "draft" : "published";

  return {
    frontmatter,
    computed: { slug, readingTime, contentId: slug, status, wordCount },
    html,
    locale: outLocale,
    isFallback,
    url: ctx.articleToUrl(outLocale, slug)
  };
}

/**
 * Resolve one article for `(slug, locale)` with locale fallback: the native
 * `{locale}.md` is preferred (`isFallback: false`); when absent, the
 * default-locale file is used (`isFallback: true`, requested locale retained).
 * Returns `null` when neither file exists.
 *
 * @param ctx - Kernel-free domain context.
 * @param slug - Article directory name.
 * @param locale - Requested locale code.
 * @returns The resolved Article, or `null` when nothing matches.
 * @example
 * ```ts
 * const article = await resolveArticle(ctx, "intro", "uk");
 * ```
 */
async function resolveArticle(
  ctx: ContentApiContext,
  slug: string,
  locale: string
): Promise<Article | null> {
  const native = await readArticle(ctx, slug, locale, locale, false);
  if (native !== null) return native;
  const fallbackLocale = ctx.defaultLocale();
  if (fallbackLocale === locale) {
    // eslint-disable-next-line unicorn/no-null -- resolveArticle returns `Article | null`; no fallback possible
    return null;
  }
  return readArticle(ctx, slug, fallbackLocale, locale, true);
}

/**
 * Comparator sorting articles by frontmatter date descending (newest first),
 * breaking ties by slug for deterministic ordering.
 *
 * @param a - First article.
 * @param b - Second article.
 * @returns Negative when `a` is newer, positive when older, 0 when equal.
 * @example
 * ```ts
 * articles.toSorted(byDateDescending);
 * ```
 */
function byDateDescending(a: Article, b: Article): number {
  const byDate = b.frontmatter.date.localeCompare(a.frontmatter.date);
  return byDate === 0 ? a.computed.slug.localeCompare(b.computed.slug) : byDate;
}

/**
 * Project a full Article to a lightweight ArticleCard (no rendered HTML).
 *
 * @param article - The source article.
 * @returns The card projection.
 * @example
 * ```ts
 * const card = toCard(article);
 * ```
 */
function toCard(article: Article): ArticleCard {
  return {
    contentId: article.computed.contentId,
    status: article.computed.status,
    title: article.frontmatter.title,
    date: article.frontmatter.date,
    description: article.frontmatter.description,
    tags: article.frontmatter.tags,
    readingTime: article.computed.readingTime,
    url: article.url
  };
}

/**
 * Creates the content plugin API surface (loadAll, load, renderMarkdown,
 * invalidate, articleToCard) over the kernel-free domain context. The processor
 * is a lazy singleton on `ctx.state.processor`; drafts are excluded only in
 * production mode; `loadAll` emits `content:ready` and `invalidate` emits
 * `content:invalidated`.
 *
 * @param ctx - Kernel-free domain context (state, config, global, emit, i18n helpers).
 * @returns The content plugin {@link Api} surface.
 * @example
 * ```ts
 * const api = createContentApi(apiContext);
 * const byLocale = await api.loadAll();
 * ```
 */
export function createContentApi(ctx: ContentApiContext): Api {
  return {
    /**
     * Load every article across every active locale, returning a locale-keyed
     * map of date-descending Article arrays. Lazily builds the processor and
     * discovers slugs, applies locale fallback, excludes drafts in production,
     * assigns `contentId` after sorting, then emits `content:ready`.
     *
     * @returns A locale-keyed map of date-descending articles.
     * @example
     * ```ts
     * const byLocale = await api.loadAll();
     * ```
     */
    async loadAll(): Promise<Map<string, Article[]>> {
      const slugs = ctx.state.slugs ?? (await discoverSlugs(ctx.config.contentDir));
      ctx.state.slugs = slugs;
      const isProduction = ctx.global.mode === "production";

      const result = new Map<string, Article[]>();
      let total = 0;
      const locales = ctx.locales();
      for (const locale of locales) {
        const resolved = await Promise.all(slugs.map(slug => resolveArticle(ctx, slug, locale)));
        const present = resolved
          .filter((article): article is Article => article !== null)
          .filter(article => isProduction === false || article.computed.status !== "draft")
          .toSorted(byDateDescending);

        const cache = new Map<string, Article>();
        let index = 0;
        for (const article of present) {
          article.computed.contentId = `${locale}:${String(index).padStart(4, "0")}:${article.computed.slug}`;
          cache.set(article.computed.slug, article);
          index += 1;
        }
        ctx.state.articles.set(locale, cache);
        result.set(locale, present);
        total += present.length;
      }
      ctx.state.dirtyPaths.clear();
      ctx.emit("content:ready", { locales, articleCount: total });
      return result;
    },

    /**
     * Resolve and render a single article for one locale with locale fallback.
     * Throws a `[web] content` error when neither the requested nor the
     * default-locale file exists. In production a `draft` article is suppressed
     * and throws the SAME not-found error (drafts must be indistinguishable from
     * missing articles so unpublished content is never disclosed); in
     * development drafts load normally.
     *
     * @param slug - Article directory name.
     * @param locale - Requested locale code.
     * @returns The resolved Article.
     * @throws {Error} `[web] content` not-found when no file matches, or when the
     *   resolved article is a draft and `global.mode === "production"`.
     * @example
     * ```ts
     * const article = await api.load("intro", "uk");
     * ```
     */
    async load(slug: string, locale: string): Promise<Article> {
      const article = await resolveArticle(ctx, slug, locale);
      if (article === null) {
        throw articleNotFound(slug, locale);
      }
      const isProduction = ctx.global.mode === "production";
      if (isProduction && article.computed.status === "draft") {
        throw articleNotFound(slug, locale);
      }
      const cache = ctx.state.articles.get(locale) ?? new Map<string, Article>();
      cache.set(slug, article);
      ctx.state.articles.set(locale, cache);
      return article;
    },

    /**
     * Render a raw Markdown string to HTML through the full pipeline (sanitize
     * last when `trustedContent` is false). Lazily builds the processor.
     *
     * @param md - Raw Markdown source.
     * @returns The rendered HTML string.
     * @example
     * ```ts
     * const html = await api.renderMarkdown("# Hi");
     * ```
     */
    async renderMarkdown(md: string): Promise<string> {
      const processor = ensureProcessor(ctx.state, ctx.config);
      return String(await processor.process(md));
    },

    /**
     * Mark file paths stale for incremental dev rebuilds. Each non-blank path is
     * added to `dirtyPaths` and its derived slug cache entry is dropped so the
     * next `loadAll()` re-reads only those files. Empty/whitespace paths are
     * ignored. Emits `content:invalidated` with the accepted paths.
     *
     * @param paths - File paths to invalidate.
     * @example
     * ```ts
     * api.invalidate(["src/content/intro/en.md"]);
     * ```
     */
    invalidate(paths: readonly string[]): void {
      const accepted: string[] = [];
      for (const path of paths) {
        if (path.trim() === "") continue;
        accepted.push(path);
        ctx.state.dirtyPaths.add(path);
        const segments = path.split(/[/\\]/);
        const slug = segments.at(-2);
        if (slug !== undefined) {
          for (const cache of ctx.state.articles.values()) {
            cache.delete(slug);
          }
        }
      }
      // eslint-disable-next-line unicorn/no-null -- `slugs` is `string[] | null`; reset forces a rescan
      ctx.state.slugs = null;
      ctx.emit("content:invalidated", { paths: accepted });
    },

    /**
     * Project a full Article to a lightweight ArticleCard for list/grid
     * rendering without shipping rendered HTML.
     *
     * @param article - The source article.
     * @returns The card projection.
     * @example
     * ```ts
     * const card = api.articleToCard(article);
     * ```
     */
    articleToCard(article: Article): ArticleCard {
      return toCard(article);
    }
  };
}
