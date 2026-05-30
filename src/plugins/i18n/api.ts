/**
 * @file i18n plugin — config validation + API factory.
 */
import type { Api, Config } from "./types";

/** Error prefix for all i18n lifecycle failures. */
const ERROR_PREFIX = "[web]";

/** Core-plugin context surface (`{ config }`) consumed by the i18n functions. */
type I18nContext = {
  readonly config: Config;
};

/**
 * Validates the resolved i18n config (fail-fast at `createApp`). Throws when
 * `locales` is empty or when `defaultLocale` is not a member of `locales`.
 * Errors use the `[web]` prefix with an actionable remediation line.
 *
 * @param ctx - Plugin context carrying the resolved {@link Config}.
 * @param ctx.config - The resolved i18n {@link Config}.
 * @throws {Error} If `locales` is empty or `defaultLocale` is not in `locales`.
 * @example
 * ```ts
 * validateI18nConfig({ config: { locales: ["en"], defaultLocale: "en" } });
 * ```
 */
export function validateI18nConfig(ctx: I18nContext): void {
  const { locales, defaultLocale } = ctx.config;
  if (locales.length === 0) {
    throw new Error(
      `${ERROR_PREFIX} i18n.locales must contain at least one locale.\n` +
        '  Set pluginConfigs.i18n.locales to a non-empty array, e.g. ["en"].'
    );
  }
  if (!locales.includes(defaultLocale)) {
    throw new Error(
      `${ERROR_PREFIX} i18n.defaultLocale "${defaultLocale}" is not in i18n.locales [${locales.join(", ")}].\n` +
        `  Set pluginConfigs.i18n.defaultLocale to one of the configured locales, or add "${defaultLocale}" to i18n.locales.`
    );
  }
}

/**
 * Creates the i18n plugin API surface — locale registry accessors plus the
 * `t()` translator with default-locale fallback. Every method is a pure read
 * of `ctx.config`; none mutate, and `t()` always returns a string.
 *
 * @param ctx - Plugin context carrying the resolved {@link Config}.
 * @param ctx.config - The resolved i18n {@link Config}.
 * @returns The {@link Api} accessor surface mounted at `app.i18n`.
 * @example
 * ```ts
 * const api = createI18nApi({ config: { locales: ["en"], defaultLocale: "en" } });
 * api.t("en", "nav.home");
 * ```
 */
export function createI18nApi(ctx: I18nContext): Api {
  const { config } = ctx;
  return {
    /**
     * Returns the configured supported locales in declared order.
     *
     * @returns The configured `locales` list (priority/display order).
     * @example
     * ```ts
     * api.locales(); // ["en", "uk"]
     * ```
     */
    locales(): readonly string[] {
      return config.locales;
    },
    /**
     * Returns the fallback locale used when a requested locale is absent.
     *
     * @returns The configured `defaultLocale`.
     * @example
     * ```ts
     * api.defaultLocale(); // "en"
     * ```
     */
    defaultLocale(): string {
      return config.defaultLocale;
    },
    /**
     * Membership guard: whether `x` is one of the supported locales
     * (case-sensitive).
     *
     * @param x - Candidate locale code.
     * @returns `true` if `x ∈ locales`, else `false`.
     * @example
     * ```ts
     * api.isLocale("uk"); // true
     * ```
     */
    isLocale(x: string): boolean {
      return config.locales.includes(x);
    },
    /**
     * Human-readable display name for a locale.
     *
     * @param locale - Locale code to look up.
     * @returns The display name, or `undefined` if unmapped.
     * @example
     * ```ts
     * api.localeName("uk"); // "Українська"
     * ```
     */
    localeName(locale: string): string | undefined {
      return config.localeNames?.[locale];
    },
    /**
     * Open Graph `og:locale` value for a locale.
     *
     * @param locale - Locale code to look up.
     * @returns The `og:locale` value (e.g. `"en_US"`), or `undefined` if unmapped.
     * @example
     * ```ts
     * api.ogLocale("en"); // "en_US"
     * ```
     */
    ogLocale(locale: string): string | undefined {
      return config.ogLocaleMap?.[locale];
    },
    /**
     * Translate `key` for `locale` with a deterministic fallback chain
     * (requested locale → default locale → the key itself). The default-locale
     * lookup is skipped when `locale === defaultLocale`.
     *
     * @param locale - Requested locale code.
     * @param key - Translation key (e.g. `"nav.home"`).
     * @returns The translated value, the default-locale value, or `key`.
     * @example
     * ```ts
     * api.t("uk", "nav.home"); // "Головна"
     * ```
     */
    t(locale: string, key: string): string {
      const exact = config.translations?.[locale]?.[key];
      if (exact !== undefined) return exact;
      if (locale !== config.defaultLocale) {
        const fallback = config.translations?.[config.defaultLocale]?.[key];
        if (fallback !== undefined) return fallback;
      }
      return key;
    }
  };
}
