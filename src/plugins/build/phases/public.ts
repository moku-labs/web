/**
 * @file build phase — public. Copies `config.publicDir` (default "public") verbatim
 * into `outDir`. Skips silently when the directory is absent. Gated by the presence
 * of a public dir on disk (the phase is always registered; it no-ops when missing).
 */
import { existsSync } from "node:fs";
import { cp } from "node:fs/promises";
import path from "node:path";
import type { PhaseContext } from "../types";

/** Default public directory copied verbatim into the output directory. */
export const DEFAULT_PUBLIC_DIR = "public";

/**
 * Result of the public phase — the resolved source directory and a copied marker.
 *
 * @example
 * ```ts
 * const result: PublicResult = { from: "public", copied: 3 };
 * ```
 */
export type PublicResult = {
  /** The resolved public source directory that was copied. */
  from: string;
  /** A nonzero marker that the copy ran (1 = directory copied recursively). */
  copied: number;
};

/**
 * Copies the configured `publicDir` (default `"public"`) verbatim into `outDir`,
 * preserving the nested directory structure. Skips silently (returns `null`) when
 * the source directory does not exist.
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
  await cp(from, ctx.config.outDir, { recursive: true });
  ctx.log.debug("build:public", { from, dest: ctx.config.outDir });
  return { from: path.normalize(from), copied: 1 };
}
