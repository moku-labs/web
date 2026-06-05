/**
 * @file i18n plugin — public type definitions (Config + Api).
 */

/**
 * i18n plugin configuration.
 *
 * `locales` and `defaultLocale` are required and validated in `onInit`. The
 * optional maps default to empty objects so every lookup method is total —
 * lookups return `undefined` on a miss and `t()` falls back to the key.
 *
 * @example
 * ```ts
 * {
 *   locales: ["en", "uk"],
 *   defaultLocale: "en",
 *   localeNames: { en: "English", uk: "Українська" },
 *   ogLocaleMap: { en: "en_US", uk: "uk_UA" },
 *   translations: { en: { "nav.home": "Home" }, uk: { "nav.home": "Головна" } }
 * }
 * ```
 */
export type Config = {
  readonly locales: readonly string[];
  readonly defaultLocale: string;
  readonly localeNames?: Record<string, string>;
  readonly ogLocaleMap?: Record<string, string>;
  readonly translations?: Record<string, Record<string, string>>;
};

/**
 * Public API of the i18n plugin. Injected as `app.i18n` and reachable from
 * other plugins via `ctx.require(i18nPlugin)`.
 */
export type Api = {
  /**
   * Returns the configured supported locales in declared order.
   *
   * @returns The configured `locales` list (priority/display order).
   * @example
   * ```ts
   * app.i18n.locales(); // ["en", "uk"]
   * ```
   */
  locales(): readonly string[];
  /**
   * Returns the fallback locale used when a requested locale is absent.
   *
   * @returns The configured `defaultLocale`.
   * @example
   * ```ts
   * app.i18n.defaultLocale(); // "en"
   * ```
   */
  defaultLocale(): string;
  /**
   * Membership guard: whether `x` is one of the supported locales.
   *
   * @param x - Candidate locale code.
   * @returns `true` if `x ∈ locales`, else `false`.
   * @example
   * ```ts
   * app.i18n.isLocale("uk"); // true
   * ```
   */
  isLocale(x: string): boolean;
  /**
   * Human-readable display name for a locale.
   *
   * @param locale - Locale code to look up.
   * @returns The display name, or `undefined` if unmapped.
   * @example
   * ```ts
   * app.i18n.localeName("uk"); // "Українська"
   * ```
   */
  localeName(locale: string): string | undefined;
  /**
   * Open Graph `og:locale` value for a locale.
   *
   * @param locale - Locale code to look up.
   * @returns The `og:locale` value (e.g. `"en_US"`), or `undefined` if unmapped.
   * @example
   * ```ts
   * app.i18n.ogLocale("en"); // "en_US"
   * ```
   */
  ogLocale(locale: string): string | undefined;
  /**
   * Translate `key` for `locale` with a deterministic fallback chain
   * (requested locale → default locale → the key itself).
   *
   * @param locale - Requested locale code.
   * @param key - Translation key (e.g. `"nav.home"`).
   * @returns The translated value, the default-locale value, or `key`.
   * @example
   * ```ts
   * app.i18n.t("uk", "nav.home"); // "Головна"
   * ```
   */
  t(locale: string, key: string): string;
};
