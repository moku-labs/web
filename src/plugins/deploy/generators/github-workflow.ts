/**
 * @file deploy plugin — pure SHA-pinned GitHub Actions workflow generator.
 */

/**
 * Generate a SHA-pinned GitHub Actions workflow that builds and deploys to
 * Cloudflare Pages. Actions are pinned to commit SHAs (with `# vX` comments) and
 * the wrangler version comes from the single MOKU_WRANGLER_VERSION source of truth.
 *
 * @param _input - The generator inputs.
 * @param _input.slug - Cloudflare project-name slug used as wrangler --project-name.
 * @throws {Error} Always — skeleton stub, implemented during build.
 * @example
 * generateGithubWorkflow({ slug: "my-site" });
 */
export function generateGithubWorkflow(_input: { slug: string }): string {
  throw new Error("not implemented");
}
