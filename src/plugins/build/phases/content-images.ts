/**
 * @file build phase — content-images. Copies each article's co-located image directory
 * (`<contentDir>/<slug>/images/`) to a single shared output dir (`<outDir>/<slug>/images/`) reused by
 * every locale, matching the absolute `/<slug>/images/...` URLs the content renderer emits. Gated by
 * `config.images`.
 */

import { existsSync } from "node:fs";
import { cp, readdir } from "node:fs/promises";
import path from "node:path";
import { contentPlugin } from "../../content";
import type { PhaseContext } from "../types";

/** Conventional per-article image subdirectory name (alongside `<slug>/<locale>.md`). */
const ARTICLE_IMAGE_DIR = "images";

/**
 * Copy every article's co-located `images/` directory to `<outDir>/<slug>/images/`. No-op when
 * `config.images` is false or the content directory does not exist.
 *
 * @param ctx - Plugin context (provides `config`, `log`, `require`).
 * @returns The number of directories copied (one per article that has an `images/` dir).
 * @example
 * ```ts
 * const copied = await copyContentImages(ctx);
 * ```
 */
export async function copyContentImages(
  ctx: Pick<PhaseContext, "config" | "log" | "require">
): Promise<number> {
  if (!ctx.config.images) {
    ctx.log.debug("build:content-images", { skipped: true });
    return 0;
  }

  const contentDir = ctx.require(contentPlugin).contentDir();
  if (!existsSync(contentDir)) {
    ctx.log.debug("build:content-images", { skipped: true, reason: "no content dir" });
    return 0;
  }

  const entries = await readdir(contentDir, { withFileTypes: true });

  let copied = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = path.join(contentDir, entry.name, ARTICLE_IMAGE_DIR);
    if (!existsSync(source)) continue;
    await cp(source, path.join(ctx.config.outDir, entry.name, ARTICLE_IMAGE_DIR), {
      recursive: true
    });
    copied += 1;
  }

  ctx.log.debug("build:content-images", { copied });
  return copied;
}
