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
  if (!ctx.config.images) {
    ctx.log.debug("build:images", { skipped: true });
    return 0;
  }
  const sourceDirectories = options.sourceDirectories ?? IMAGE_SOURCE_DIRECTORIES;
  const target = path.join(ctx.config.outDir, "assets");
  let copied = 0;
  for (const directory of sourceDirectories) {
    if (!existsSync(directory)) continue;
    const entries = await readdir(directory);
    if (entries.length === 0) continue;
    await mkdir(target, { recursive: true });
    await cp(directory, target, { recursive: true });
    copied += 1;
  }
  ctx.log.debug("build:images", { copied });
  return copied;
}
