/**
 * @file deploy plugin — pure wrangler.jsonc generator + on-disk reader (drift check).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Generate a `wrangler.jsonc` for Cloudflare Pages. Emits `$schema`, `name`
 * (slug), `pages_build_output_dir` (outDir), and `compatibility_date`, with a
 * trailing newline.
 *
 * @param input - The generator inputs.
 * @param input.slug - Cloudflare project-name slug (written as `name`).
 * @param input.outDir - Output directory (written as `pages_build_output_dir`).
 * @param input.compatibilityDate - Compatibility date (`YYYY-MM-DD`).
 * @returns The `wrangler.jsonc` file contents.
 * @example
 * generateWranglerConfig({ slug: "my-site", outDir: "dist", compatibilityDate: "2024-01-01" });
 */
export function generateWranglerConfig(input: {
  slug: string;
  outDir: string;
  compatibilityDate: string;
}): string {
  const body = {
    $schema: "node_modules/wrangler/config-schema.json",
    name: input.slug,
    pages_build_output_dir: input.outDir,
    compatibility_date: input.compatibilityDate
  };
  return `${JSON.stringify(body, undefined, 2)}\n`;
}

/**
 * Read an existing `wrangler.jsonc` from the project root for the drift check, or
 * `null` when it does not exist.
 *
 * @param cwd - Project root containing `wrangler.jsonc`.
 * @returns The file contents, or `null` when the file is absent.
 * @example
 * await readWranglerConfig(process.cwd());
 */
export async function readWranglerConfig(cwd: string): Promise<string | null> {
  try {
    return await readFile(path.join(cwd, "wrangler.jsonc"), "utf8");
  } catch {
    // eslint-disable-next-line unicorn/no-null -- "absent" is modeled as null.
    return null;
  }
}
