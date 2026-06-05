/**
 * @file head plugin — default config, structural validation, and normalization.
 *
 * Kept separate from `index.ts` so the wiring harness stays thin: the default
 * config object, the `[web] head: …` validation, and the frozen-snapshot
 * normalization all live here and are referenced by name from `index.ts`.
 */
import type { Config, HeadDefaults } from "./types";

/** Error prefix for all head config-validation failures. */
const ERROR_PREFIX = "[web] head";

/** The allowed `twitterCard` literals (also the runtime guard set). */
const VALID_TWITTER_CARDS = ["summary", "summary_large_image"] as const;

/**
 * Framework default head config. Consumers override via `pluginConfigs.head`.
 * `twitterCard` defaults to the large-image card; all other fields are absent
 * (the optional fields are left `undefined` per `exactOptionalPropertyTypes`).
 *
 * @example
 * ```ts
 * createPlugin("head", { config: defaultConfig });
 * ```
 */
export const defaultConfig: Config = { twitterCard: "summary_large_image" };

/**
 * Structurally validate the resolved head config (no I/O). Throws a standard
 * `[web] head: …` error when `titleTemplate` is provided without the `%s`
 * token, or when `twitterCard` is present but not one of the two allowed literals.
 *
 * @param config - The resolved head {@link Config} to validate.
 * @throws {Error} If `titleTemplate` lacks `%s`, or `twitterCard` is invalid.
 * @example
 * ```ts
 * validateHeadConfig({ titleTemplate: "%s — Site" });
 * ```
 */
export function validateHeadConfig(config: Config): void {
  if (config.titleTemplate !== undefined && !config.titleTemplate.includes("%s")) {
    throw new Error(
      `${ERROR_PREFIX}: titleTemplate must contain the "%s" token (replaced by the route title), received ${JSON.stringify(config.titleTemplate)}.`
    );
  }
  if (config.twitterCard !== undefined && !VALID_TWITTER_CARDS.includes(config.twitterCard)) {
    throw new Error(
      `${ERROR_PREFIX}: twitterCard must be one of [${VALID_TWITTER_CARDS.join(", ")}], received ${JSON.stringify(config.twitterCard)}.`
    );
  }
}

/**
 * Validate then build the frozen, normalized {@link HeadDefaults} snapshot read by
 * `render`. `twitterCard` is defaulted to `"summary_large_image"`; optional fields
 * are copied through only when present (preserving `exactOptionalPropertyTypes`).
 *
 * @param config - The resolved head {@link Config}.
 * @returns A frozen normalized defaults snapshot.
 * @throws {Error} If the config fails {@link validateHeadConfig}.
 * @example
 * ```ts
 * normalizeHeadConfig({ titleTemplate: "%s — Site" });
 * ```
 */
export function normalizeHeadConfig(config: Config): HeadDefaults {
  validateHeadConfig(config);
  const defaults: { -readonly [K in keyof HeadDefaults]: HeadDefaults[K] } = {
    twitterCard: config.twitterCard ?? "summary_large_image"
  };
  if (config.titleTemplate !== undefined) defaults.titleTemplate = config.titleTemplate;
  if (config.defaultOgImage !== undefined) defaults.defaultOgImage = config.defaultOgImage;
  if (config.twitterHandle !== undefined) defaults.twitterHandle = config.twitterHandle;
  return Object.freeze(defaults);
}
