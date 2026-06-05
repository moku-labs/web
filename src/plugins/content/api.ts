/**
 * @file content plugin — API factory (browser-safe SHELL).
 *
 * Orchestration ONLY: locale fallback, draft filtering, date-descending sort,
 * `contentId` assignment, the article cache, and events. All source I/O + the
 * Markdown pipeline live in a {@link ContentProvider} (e.g. `fileSystemContent`),
 * resolved from `config.providers`. This module imports ZERO node code — so
 * `contentPlugin` is browser-safe and is exported from `@moku-labs/web/browser`.
 */
import { i18nPlugin } from "../i18n";
import type { Api as I18nApi } from "../i18n/types";
import type {
  Api,
  Article,
  ArticleCard,
  Config,
  ContentApiContext,
  ContentEvents,
  ContentProvider,
  State
} from "./types";

/** Actionable error when the content plugin is composed without any provider. */
const NO_PROVIDER =
  "[web] content: no provider composed.\n  Add fileSystemContent(...) to pluginConfigs.content.providers.";

/**
 * Minimal structural shape of the plugin context that {@link contentApi} consumes —
 * shell state, config (providers), global, emit, and the typed `require` accessor used
 * to reach the i18n plugin API. Typed loosely on purpose so api.ts stays free of the
 * kernel's full plugin-context generic machinery (and of any node import).
 *
 * @example
 * ```ts
 * const api = contentApi(ctx);
 * ```
 */
export type ContentPluginContext = {
  /** Mutable shell state (article cache). */
  state: State;
  /** Resolved plugin configuration (the content providers). */
  config: Config;
  /** Global framework configuration (development flag). */
  global: { isDevelopment: boolean };
  /** Emit a registered content event. */
  emit: <K extends keyof ContentEvents>(event: K, payload: ContentEvents[K]) => void;
  /** Resolve a depended-upon plugin's API (here the i18n plugin). */
  require: (plugin: typeof i18nPlugin) => I18nApi;
};

/**
 * Collapse the ordered provider list into a single {@link ContentProvider} facade:
 * `slugs()` are unioned, `readArticle`/`render` use first-match, `invalidate` fans out.
 * A single-provider list returns that provider directly (the common case).
 *
 * @param providers - The ordered content providers from config.
 * @returns One provider facade over the list.
 * @example
 * ```ts
 * const provider = mergeProviders(ctx.config.providers);
 * ```
 */
function mergeProviders(providers: readonly ContentProvider[]): ContentProvider {
  const [first] = providers;
  if (providers.length === 1 && first !== undefined) return first;
  // Below runs only for length >= 2 (validate.ts rejects 0; the fast path above
  // handles 1). The `|| "content:empty"`, `?? ""`, and NO_PROVIDER throw are thus
  // unreachable defensive guards, kept so the facade is total over its types.
  return {
    name: providers.map(provider => provider.name).join("+") || "content:empty",
    contentDir: first?.contentDir ?? "",
    /**
     * Union of every provider's slugs, sorted.
     *
     * @returns The merged slug list.
     * @example
     * ```ts
     * await provider.slugs();
     * ```
     */
    async slugs(): Promise<readonly string[]> {
      const lists = await Promise.all(providers.map(provider => provider.slugs()));
      return [...new Set(lists.flat())].toSorted();
    },
    /**
     * First provider to supply the article wins.
     *
     * @param slug - Article directory name.
     * @param fileLocale - Locale whose source file is read.
     * @param outLocale - Locale the resulting Article represents.
     * @param isFallback - Whether this used the default-locale fallback.
     * @returns The first non-null Article, or `null`.
     * @example
     * ```ts
     * await provider.readArticle("intro", "en", "en", false);
     * ```
     */
    async readArticle(
      slug: string,
      fileLocale: string,
      outLocale: string,
      isFallback: boolean
    ): Promise<Article | null> {
      const found = await Promise.all(
        providers.map(provider => provider.readArticle(slug, fileLocale, outLocale, isFallback))
      );
      // eslint-disable-next-line unicorn/no-null -- API contract is `Article | null`
      return found.find((article): article is Article => article !== null) ?? null;
    },
    /**
     * Render via the first provider.
     *
     * @param markdown - Raw Markdown source.
     * @returns The rendered HTML.
     * @throws {Error} If no provider is composed.
     * @example
     * ```ts
     * await provider.render("# Hi");
     * ```
     */
    async render(markdown: string): Promise<string> {
      if (first === undefined) throw new Error(NO_PROVIDER);
      return first.render(markdown);
    },
    /**
     * Fan invalidation out to every provider.
     *
     * @param paths - Stale file paths.
     * @example
     * ```ts
     * provider.invalidate(["content/intro/en.md"]);
     * ```
     */
    invalidate(paths: readonly string[]): void {
      for (const provider of providers) provider.invalidate?.(paths);
    }
  };
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
 * Plugin `api` factory: resolves i18n via `ctx.require`, merges `config.providers` into
 * one source, assembles the kernel-free {@link ContentApiContext}, and delegates to
 * {@link createContentApi}. Referenced directly as the plugin's `api` so index.ts stays
 * wiring-only. Imports no node code (the provider owns it).
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
    global: ctx.global,
    emit: ctx.emit,
    locales,
    defaultLocale,
    provider: mergeProviders(ctx.config.providers)
  };
  return createContentApi(apiContext);
}

/**
 * Resolve one article for `(slug, locale)` with locale fallback via the provider: the
 * native `{locale}` file is preferred (`isFallback: false`); when absent, the
 * default-locale file is used (`isFallback: true`, requested locale retained).
 * Returns `null` when neither exists.
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
  const native = await ctx.provider.readArticle(slug, locale, locale, false);
  if (native !== null) return native;
  const fallbackLocale = ctx.defaultLocale();
  if (fallbackLocale === locale) {
    // eslint-disable-next-line unicorn/no-null -- resolveArticle returns `Article | null`; no fallback possible
    return null;
  }
  return ctx.provider.readArticle(slug, fallbackLocale, locale, true);
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
 * Creates the content plugin API surface (loadAll, load, renderMarkdown, invalidate,
 * articleToCard, contentDir) over the kernel-free domain context. Delegates all source
 * reads to `ctx.provider`; drafts are excluded only in production; `loadAll` emits
 * `content:ready` and `invalidate` emits `content:invalidated`.
 *
 * @param ctx - Kernel-free domain context (state, global, emit, i18n helpers, provider).
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
     * Load every article across every active locale (locale fallback, production
     * draft exclusion, date sort, `contentId` after sort), cache them, emit `content:ready`.
     *
     * @returns A locale-keyed map of date-descending articles.
     * @example
     * ```ts
     * const byLocale = await api.loadAll();
     * ```
     */
    async loadAll(): Promise<Map<string, Article[]>> {
      const slugs = await ctx.provider.slugs();
      const isProduction = !ctx.global.isDevelopment;

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
      ctx.emit("content:ready", { locales, articleCount: total });
      return result;
    },

    /**
     * Resolve and render a single article for one locale with locale fallback. Throws a
     * `[web] content` not-found error when no file matches; in production a `draft` is
     * suppressed and throws the SAME not-found error (drafts indistinguishable from
     * missing); in development drafts load normally.
     *
     * @param slug - Article directory name.
     * @param locale - Requested locale code.
     * @returns The resolved Article.
     * @throws {Error} `[web] content` not-found when no file matches, or when the
     *   resolved article is a draft and `!global.isDevelopment` (production).
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
      const isProduction = !ctx.global.isDevelopment;
      if (isProduction && article.computed.status === "draft") {
        throw articleNotFound(slug, locale);
      }
      const cache = ctx.state.articles.get(locale) ?? new Map<string, Article>();
      cache.set(slug, article);
      ctx.state.articles.set(locale, cache);
      return article;
    },

    /**
     * Render a raw Markdown string to HTML through the provider's pipeline.
     *
     * @param md - Raw Markdown source.
     * @returns The rendered HTML string.
     * @example
     * ```ts
     * const html = await api.renderMarkdown("# Hi");
     * ```
     */
    async renderMarkdown(md: string): Promise<string> {
      return ctx.provider.render(md);
    },

    /**
     * Mark file paths stale for incremental dev rebuilds: fan invalidation to the
     * provider and drop the derived slug cache entries so the next `loadAll()` re-reads
     * only those files. Empty/whitespace paths are ignored. Emits `content:invalidated`.
     *
     * @param paths - File paths to invalidate.
     * @example
     * ```ts
     * api.invalidate(["src/content/intro/en.md"]);
     * ```
     */
    invalidate(paths: readonly string[]): void {
      const accepted = paths.filter(filePath => filePath.trim() !== "");
      ctx.provider.invalidate?.(accepted);
      for (const filePath of accepted) {
        const segments = filePath.split(/[/\\]/);
        const slug = segments.at(-2);
        if (slug !== undefined) {
          for (const cache of ctx.state.articles.values()) {
            cache.delete(slug);
          }
        }
      }
      ctx.emit("content:invalidated", { paths: accepted });
    },

    /**
     * Project a full Article to a lightweight ArticleCard for list/grid rendering.
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
    },

    /**
     * The configured content source directory (from the first provider).
     *
     * @returns The content directory path.
     * @example
     * ```ts
     * api.contentDir(); // "./content"
     * ```
     */
    contentDir(): string {
      return ctx.provider.contentDir;
    }
  };
}
