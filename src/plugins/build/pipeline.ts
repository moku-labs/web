/**
 * @file build plugin — pipeline driver. Sequences the fixed multi-phase build,
 * emits `build:phase` boundaries, and runs intra-phase work via `Promise.all`.
 */
import type { BuildResult, PhaseName } from "./types";

/**
 * The static ordered list of pipeline phase names.
 *
 * @example
 * ```ts
 * const first = PHASE_ORDER[0];
 * ```
 */
export const PHASE_ORDER: readonly PhaseName[] = [
  "bundle",
  "content",
  "images",
  "pages",
  "feeds",
  "sitemap",
  "og-images",
  "root-index"
] as const;

/**
 * Executes the full SSG pipeline for one run: clean → bundle → content/images →
 * pages → feeds/sitemap/og-images → root-index. Orchestrates `ctx.require` pulls
 * and `Promise.all` only — never inlines dependency domain logic.
 *
 * @param _ctx - Plugin context (provides `require`, `emit`, `state`, `config`, `log`).
 * @param _options - Optional run overrides.
 * @param _options.outDir - Override the configured output directory for this run.
 * @example
 * ```ts
 * const result = await runPipeline(ctx, { outDir: "./dist" });
 * ```
 */
export function runPipeline(_ctx: unknown, _options?: { outDir?: string }): Promise<BuildResult> {
  throw new Error("not implemented");
}
