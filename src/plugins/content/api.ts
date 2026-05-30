/**
 * @file content plugin — API factory + context-assembly skeleton.
 */
import { i18nPlugin } from "../i18n";
import type { Api as I18nApi } from "../i18n/types";
import type { Api, Config, ContentApiContext, ContentEvents, State } from "./types";

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
 * Creates the content plugin API surface (loadAll, load, renderMarkdown,
 * invalidate, articleToCard) over the kernel-free domain context.
 *
 * @param _ctx - Kernel-free domain context (state, config, global, emit, i18n helpers).
 * @example
 * ```ts
 * const api = createContentApi(apiContext);
 * ```
 */
export function createContentApi(_ctx: ContentApiContext): Api {
  throw new Error("not implemented");
}
