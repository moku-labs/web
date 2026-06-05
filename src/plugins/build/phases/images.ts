/**
 * @file build phase 2 — images. Optimizes + copies content images to outDir.
 * Gated by config.images.
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type { PhaseContext } from "../types";

/** Conventional source directories scanned for static images to copy. */
const IMAGE_SOURCE_DIRECTORIES = ["public", "static"] as const;

/**
 * The optional dependency-injection seam for {@link processImages}.
 *
 * @example
 * ```ts
 * await processImages(ctx, { sourceDirectories: ["fixtures/public"] });
 * ```
 */
export type ImagesOptions = {
  /** Override the source directories scanned for images (defaults to public/static). */
  sourceDirectories?: readonly string[];
};

/**
 * Copy one source directory into the assets target, skipping it when the
 * directory is absent or empty. The target is created lazily so an all-empty
 * build never touches `outDir`.
 *
 * @param directory - The candidate source directory to copy.
 * @param target - The assets directory inside `outDir` to copy into.
 * @returns `true` when the directory was copied, `false` when skipped.
 * @example
 * ```ts
 * const didCopy = await copyImageDirectory("public", "dist/assets");
 * ```
 */
async function copyImageDirectory(directory: string, target: string): Promise<boolean> {
  // Skip directories that don't exist or hold nothing to copy.
  const isMissing = !existsSync(directory);
  if (isMissing) return false;
  const entries = await readdir(directory);
  const isEmpty = entries.length === 0;
  if (isEmpty) return false;

  // Materialize the target lazily, then copy the directory verbatim.
  await mkdir(target, { recursive: true });
  await cp(directory, target, { recursive: true });
  return true;
}

/**
 * Copies static image directories into the output directory. No-op when
 * `config.images` is false or no source directory exists. Image bytes are copied
 * verbatim (optimization is a no-op hook point) — build only sequences I/O.
 *
 * @param ctx - Plugin context (provides `config`, `log`).
 * @param options - Optional dependency-injection seam (source directories).
 * @returns The number of source directories copied.
 * @example
 * ```ts
 * const copied = await processImages(ctx);
 * ```
 */
export async function processImages(
  ctx: Pick<PhaseContext, "config" | "log">,
  options: ImagesOptions = {}
): Promise<number> {
  // Images are opt-in — a disabled build skips the phase entirely.
  if (!ctx.config.images) {
    ctx.log.debug("build:images", { skipped: true });
    return 0;
  }

  // Resolve the directories to scan and the assets target inside outDir.
  const sourceDirectories = options.sourceDirectories ?? IMAGE_SOURCE_DIRECTORIES;
  const target = path.join(ctx.config.outDir, "assets");

  // Copy each present, non-empty source directory and tally the successes.
  let copied = 0;
  for (const directory of sourceDirectories) {
    if (await copyImageDirectory(directory, target)) copied += 1;
  }

  ctx.log.debug("build:images", { copied });
  return copied;
}
