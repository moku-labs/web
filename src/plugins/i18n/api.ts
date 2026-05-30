/**
 * @file i18n plugin — config validation + API factory.
 */
import type { Api } from "./types";

/**
 * Validates the resolved i18n config (fail-fast at `createApp`). Throws when
 * `locales` is empty or when `defaultLocale` is not a member of `locales`.
 * Errors use the `[web]` prefix.
 *
 * @param _ctx - Plugin context (`{ config }`); unused in skeleton.
 * @example
 * ```ts
 * validateI18nConfig(ctx);
 * ```
 */
export function validateI18nConfig(_ctx: unknown): void {
  throw new Error("not implemented");
}

/**
 * Creates the i18n plugin API surface — locale registry accessors plus the
 * `t()` translator with default-locale fallback.
 *
 * @param _ctx - Plugin context (`{ config }`); unused in skeleton.
 * @example
 * ```ts
 * const api = createI18nApi(ctx);
 * ```
 */
export function createI18nApi(_ctx: unknown): Api {
  throw new Error("not implemented");
}
