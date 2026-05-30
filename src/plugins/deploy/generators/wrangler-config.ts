/**
 * @file deploy plugin — pure wrangler.jsonc generator + on-disk reader (drift check).
 */

/** Shared skeleton stub message (factored out to avoid duplicate-literal lint). */
const NOT_IMPLEMENTED = "not implemented";

/**
 * Generate a wrangler.jsonc for Cloudflare Pages.
 *
 * @param _input - The generator inputs.
 * @param _input.slug - Cloudflare project-name slug (written as "name").
 * @param _input.outDir - Output directory (written as "pages_build_output_dir").
 * @param _input.compatibilityDate - Compatibility date (YYYY-MM-DD).
 * @throws {Error} Always — skeleton stub, implemented during build.
 * @example
 * generateWranglerConfig({ slug: "my-site", outDir: "dist", compatibilityDate: "2024-01-01" });
 */
export function generateWranglerConfig(_input: {
  slug: string;
  outDir: string;
  compatibilityDate: string;
}): string {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Read an existing wrangler.jsonc from the project root for the drift check, or
 * null when it does not exist.
 *
 * @param _cwd - Project root containing wrangler.jsonc.
 * @throws {Error} Always — skeleton stub, implemented during build.
 * @example
 * await readWranglerConfig(process.cwd());
 */
export function readWranglerConfig(_cwd: string): Promise<string | null> {
  throw new Error(NOT_IMPLEMENTED);
}
