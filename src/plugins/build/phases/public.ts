/**
 * @file build phase — public. Incrementally copies `config.publicDir` (default "public")
 * into `outDir`: a file is copied only when its destination is missing or stale (size or
 * mtime mismatch — see {@link copyPublic}). Skips silently when the directory is absent.
 * Gated by the presence of a public dir on disk (the phase is always registered; it
 * no-ops when missing).
 */
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { PhaseContext } from "../types";

/** Default public directory copied verbatim into the output directory. */
export const DEFAULT_PUBLIC_DIR = "public";

/**
 * Result of the public phase — the resolved source directory and the copy count.
 *
 * @example
 * ```ts
 * const result: PublicResult = { from: "public", copied: 3 };
 * ```
 */
export type PublicResult = {
  /** The resolved public source directory that was copied. */
  from: string;
  /** Number of entries actually copied (fresh, unchanged files are skipped). */
  copied: number;
};

/**
 * Test whether `destination` is already an up-to-date copy of the `src` file: same
 * size and at least as new (mtime). A missing destination — or any stat failure —
 * reports stale: when in doubt, copy.
 *
 * @param src - The source file path.
 * @param destination - The candidate destination file path.
 * @returns `true` when the destination can be skipped.
 * @example
 * ```ts
 * if (await isFreshCopy(src, destination)) return;
 * ```
 */
async function isFreshCopy(src: string, destination: string): Promise<boolean> {
  try {
    const [srcStat, destinationStat] = await Promise.all([stat(src), stat(destination)]);
    return destinationStat.size === srcStat.size && destinationStat.mtimeMs >= srcStat.mtimeMs;
  } catch {
    return false;
  }
}

/**
 * Recursively copy `from` into `to`, skipping every file whose destination is already
 * fresh. Skipping matters in dev rebuilds (which keep the previous outDir): re-copying
 * unchanged assets makes asset-watching dev servers (wrangler) reload on src-only
 * edits, and on macOS/APFS under Bun a large-file re-copy goes through clonefile(2),
 * whose FSEvents "ItemCloned" echo on the SOURCE path re-triggers `public/**` watchers
 * — a self-sustaining rebuild loop. Serial on purpose: public dirs can hold thousands
 * of assets and the skip path is stat-only, while an unbounded parallel copy risks fd
 * exhaustion.
 *
 * @param from - The source directory.
 * @param to - The destination directory (created when missing).
 * @returns The number of entries actually copied.
 * @example
 * ```ts
 * const copied = await copyDirIncremental("public", "dist");
 * ```
 */
async function copyDirIncremental(from: string, to: string): Promise<number> {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });

  let copied = 0;
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const destination = path.join(to, entry.name);

    // Directories recurse; regular files copy only when stale; anything exotic
    // (symlinks, fifos) keeps the previous whole-tree `cp` semantics verbatim.
    if (entry.isDirectory()) {
      copied += await copyDirIncremental(src, destination);
    } else if (entry.isFile()) {
      if (await isFreshCopy(src, destination)) continue;
      await copyFile(src, destination);
      copied += 1;
    } else {
      await cp(src, destination, { recursive: true });
      copied += 1;
    }
  }
  return copied;
}

/**
 * Copies the configured `publicDir` (default `"public"`) into `outDir`, preserving the
 * nested directory structure. The copy is incremental: a file whose destination already
 * exists with the same size and an mtime at least as new as the source is skipped. A
 * full build cleans outDir first, so every file misses the compare and the output is
 * identical to a verbatim copy; a dev rebuild (`skipClean`) rewrites only what changed.
 * Skips silently (returns `null`) when the source directory does not exist.
 *
 * @param ctx - Plugin context (provides `config`, `log`).
 * @returns The copy result, or `null` when the public directory is absent.
 * @example
 * ```ts
 * const result = await copyPublic(ctx);
 * ```
 */
export async function copyPublic(
  ctx: Pick<PhaseContext, "config" | "log">
): Promise<PublicResult | null> {
  const from = ctx.config.publicDir ?? DEFAULT_PUBLIC_DIR;
  if (!existsSync(from)) {
    ctx.log.debug("build:public", { skipped: true, from });
    // eslint-disable-next-line unicorn/no-null -- `null` signals a skipped (absent dir) phase
    return null;
  }
  const copied = await copyDirIncremental(from, ctx.config.outDir);
  ctx.log.debug("build:public", { from, dest: ctx.config.outDir, copied });
  return { from: path.normalize(from), copied };
}
