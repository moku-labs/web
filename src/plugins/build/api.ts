/**
 * @file build plugin — API factory (run + phases), cross-plugin wiring, and onInit config validation.
 */
import { existsSync, readdirSync } from "node:fs";
import { PHASE_ORDER, runPipeline } from "./pipeline";
import type { Api, Config, OgImageConfig, PhaseContext, PhaseName } from "./types";

/** Error prefix for build config/validation failures (spec/11 Part-3). */
const ERROR_PREFIX = "[web] build";
/** Recognized font file extensions for OG-image validation. */
const FONT_EXTENSIONS = [".ttf", ".otf", ".woff"] as const;

/** Typed default `build` config (R6: no inline `as`). `ogImage: false` disables OG generation. */
export const defaultConfig: Config = {
  outDir: "./dist",
  minify: true,
  feeds: true,
  sitemap: true,
  images: true,
  ogImage: false
};

/**
 * Creates the `build` plugin API surface — the pipeline driver (`run`) plus the
 * `phases` introspection accessor. `run` delegates to the pipeline driver, which
 * orchestrates the per-phase `ctx.require` pulls (content/router/head/site/i18n);
 * the API itself stays wiring-thin so `index.ts` remains a harness.
 *
 * @param ctx - Plugin context (provides `require`, `emit`, `state`, `config`, `log`).
 * @returns The {@link Api} surface mounted at `app.build`.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * await api.run({ outDir: "./preview" });
 * ```
 */
export function createApi(ctx: PhaseContext): Api {
  return {
    /**
     * Run the full SSG pipeline and write the site to disk. With no options a full
     * production build runs; dev callers pass `skipClean`/`overrides`/`changed` for a
     * fast incremental rebuild (all gated behind opt-in fields — the default path is
     * unchanged).
     *
     * @param options - Optional per-run overrides (outDir / skipClean / overrides / changed).
     * @returns The build result (outDir, pageCount, durationMs).
     * @example
     * ```ts
     * await api.run({ outDir: "./preview" });
     * ```
     */
    run(options) {
      return runPipeline(ctx, options);
    },
    /**
     * List the phases in execution order (introspection / tooling).
     *
     * @returns A fresh array of the static ordered phase names.
     * @example
     * ```ts
     * api.phases();
     * ```
     */
    phases(): PhaseName[] {
      return [...PHASE_ORDER];
    }
  };
}

/**
 * Whether an OG `fontDir` value is unusable: not a string, empty, or non-existent on disk.
 *
 * @param fontDir - The configured `fontDir` value to check.
 * @returns `true` when `fontDir` is not a non-empty string pointing at an existing path.
 * @example
 * ```ts
 * isMissingFontDir("./fonts"); // false when ./fonts exists
 * ```
 */
function isMissingFontDir(fontDir: unknown): boolean {
  return typeof fontDir !== "string" || fontDir.length === 0 || !existsSync(fontDir);
}

/**
 * Validate that an OG `fontDir` exists and contains at least one font file.
 *
 * @param og - The enabled OG-image config object.
 * @throws {Error} If `fontDir` is missing or contains no `.ttf`/`.otf`/`.woff`.
 * @example
 * ```ts
 * validateFonts({ fontDir: "./fonts" });
 * ```
 */
function validateFonts(og: OgImageConfig): void {
  if (isMissingFontDir(og.fontDir)) {
    throw new Error(
      `${ERROR_PREFIX}.ogImage: fontDir "${og.fontDir}" does not exist — provide a directory with at least one font.`
    );
  }
  const hasFont = readdirSync(og.fontDir).some(name =>
    FONT_EXTENSIONS.some(extension => name.endsWith(extension))
  );
  if (!hasFont) {
    throw new Error(
      `${ERROR_PREFIX}.ogImage: fontDir "${og.fontDir}" contains no .ttf/.otf/.woff font files.`
    );
  }
}

/**
 * Validates `build` config synchronously in `onInit` (return value discarded).
 * Throws an actionable `[web] build.<field>` error when `outDir` is empty, or
 * when `ogImage` is enabled but `fontDir` is missing / has no `.ttf`/`.otf`/`.woff`.
 *
 * @param config - The resolved `build` config to validate.
 * @example
 * ```ts
 * validateConfig(ctx.config);
 * ```
 */
export function validateConfig(config: Config): void {
  // Output directory must name a real build target (non-empty string).
  if (typeof config.outDir !== "string" || config.outDir.trim().length === 0) {
    throw new Error(`${ERROR_PREFIX}.outDir: must be a non-empty string.`);
  }

  // Optional public asset directory, when set, must be a string path.
  if (config.publicDir !== undefined && typeof config.publicDir !== "string") {
    throw new Error(`${ERROR_PREFIX}.publicDir: must be a string when set.`);
  }

  // Optional HTML template, when set, must be a string path.
  if (config.template !== undefined && typeof config.template !== "string") {
    throw new Error(`${ERROR_PREFIX}.template: must be a string path when set.`);
  }

  // Optional client hydration entry, when set, must be a string path.
  if (config.clientEntry !== undefined && typeof config.clientEntry !== "string") {
    throw new Error(`${ERROR_PREFIX}.clientEntry: must be a string path when set.`);
  }

  // When OG-image generation is enabled, its font directory must be usable.
  if (config.ogImage) {
    validateFonts(config.ogImage);
  }
}
