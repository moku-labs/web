/**
 * @file deploy plugin — init/scaffold orchestrator (wrangler.jsonc + optional
 * GitHub Actions workflow, with idempotent write + drift-check modes).
 */
import type { Config, DeployInitOptions, InitResult } from "./types";

/**
 * Orchestrate scaffold generation: emit wrangler.jsonc (and deploy.yml when ci)
 * from the derived slug + config, skipping existing files or reporting drift in
 * check mode.
 *
 * @param _input - The scaffold orchestration inputs.
 * @param _input.config - Resolved deploy config (outDir, compatibilityDate, ci).
 * @param _input.slug - Cloudflare project-name slug (from toSlug(site.name())).
 * @param _input.cwd - Project root the scaffold files are written into.
 * @param _input.options - Optional ci toggle and check (drift-only) mode.
 * @throws {Error} Always — skeleton stub, implemented during build.
 * @example
 * await writeScaffolding({ config, slug: "my-site", cwd: process.cwd(), options: { ci: true } });
 */
export function writeScaffolding(_input: {
  config: Readonly<Config>;
  slug: string;
  cwd: string;
  options: DeployInitOptions;
}): Promise<InitResult> {
  throw new Error("not implemented");
}
