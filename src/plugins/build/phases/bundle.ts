/**
 * @file build phase 1 — bundle. Runs `Bun.build` for CSS and JS separately into
 * outDir (honoring `config.minify`); caches hashed asset paths for the pages phase.
 */

/**
 * Bundles CSS and JS into the output directory and caches the resulting hashed
 * asset paths in `state.buildCache` for downstream phases.
 *
 * @param _ctx - Plugin context (provides `state`, `config`, `log`).
 * @example
 * ```ts
 * await bundle(ctx);
 * ```
 */
export function bundle(_ctx: unknown): Promise<void> {
  throw new Error("not implemented");
}
