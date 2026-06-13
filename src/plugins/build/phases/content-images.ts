/**
 * @file build phase — content-images. Copies each article's co-located asset
 * directories (`<contentDir>/<slug>/<dir>/`, e.g. `images/` or a pre-built
 * `game/` embed bundle) to a single shared output location
 * (`<outDir>/<slug>/<dir>/`) reused by every locale, matching the absolute
 * `/<slug>/<dir>/...` URLs the content renderer emits (image src + `::embed`
 * src). Dot- and underscore-prefixed dirs are treated as private and skipped.
 * Gated by `config.images`.
 */

import { existsSync } from "node:fs";
import { cp, readdir } from "node:fs/promises";
import path from "node:path";
import { contentPlugin } from "../../content";
import type { PhaseContext } from "../types";

/**
 * Copy every article's co-located asset directories to `<outDir>/<slug>/<dir>/`.
 * Each direct subdirectory of `<contentDir>/<slug>/` rides along (the
 * conventional `images/` dir plus any other bundle, like an `::embed` game),
 * except `.`/`_`-prefixed dirs (private). The `.md` source files are never
 * copied (only directories are). No-op when `config.images` is false or the
 * content directory does not exist.
 *
 * @param ctx - Plugin context (provides `config`, `log`, `require`).
 * @returns The number of articles that had at least one asset directory copied.
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

  const articleDirectories = await readdir(contentDir, { withFileTypes: true });

  let copied = 0;
  for (const article of articleDirectories) {
    if (!article.isDirectory()) continue;

    const articleDir = path.join(contentDir, article.name);
    const assetDirectories = await readdir(articleDir, { withFileTypes: true });

    let copiedAny = false;
    for (const asset of assetDirectories) {
      // Only directories travel; `.`/`_`-prefixed ones are private (skip).
      if (!asset.isDirectory()) continue;
      if (asset.name.startsWith(".") || asset.name.startsWith("_")) continue;
      await cp(
        path.join(articleDir, asset.name),
        path.join(ctx.config.outDir, article.name, asset.name),
        { recursive: true }
      );
      copiedAny = true;
    }
    if (copiedAny) copied += 1;
  }

  ctx.log.debug("build:content-images", { copied });
  return copied;
}
