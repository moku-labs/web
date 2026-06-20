/**
 * i18n — Micro tier. Multi-file layout (index wiring + api.ts + types.ts) so
 * index.ts stays within the ≤30-line wiring-only hook; logic lives in api.ts.
 *
 * Locale registry + flat translation helper with default-locale fallback.
 * Pure config-as-data: no state, no events, no lifecycle resources.
 * Consumed read-only by content/router/head/build via `ctx.require(i18nPlugin)`.
 *
 * @file i18n plugin wiring harness.
 * @see README.md
 */
import { createPlugin } from "../../config";
import { createI18nApi, DEFAULT_I18N_CONFIG, validateI18nConfig } from "./api";

export { fallbackI18n } from "./api";
export type { Api, Config } from "./types";

/**
 * Internationalization plugin — locale registry plus a flat translation helper
 * with default-locale fallback. Pure config-as-data (no state or events);
 * consumed read-only by content, router, head, and build.
 *
 * @example Register locales and translations
 * ```ts
 * const app = createApp({
 *   pluginConfigs: {
 *     i18n: {
 *       locales: ["en", "uk"],
 *       defaultLocale: "en",
 *       localeNames: { en: "English", uk: "Українська" },
 *       translations: { uk: { "nav.home": "Головна" } }
 *     }
 *   }
 * });
 * ```
 */
export const i18nPlugin = createPlugin("i18n", {
  config: DEFAULT_I18N_CONFIG,
  onInit: validateI18nConfig,
  api: createI18nApi
});
