/**
 * @file build phase 2 — images. Optimizes + copies content images to outDir.
 * Gated by config.images.
 */

/**
 * Optimizes and copies content images into the output directory.
 * No-op when `config.images` is false.
 *
 * @param _ctx - Plugin context (provides `state`, `config`, `log`).
 * @example
 * ```ts
 * await processImages(ctx);
 * ```
 */
export function processImages(_ctx: unknown): Promise<void> {
  throw new Error("not implemented");
}
