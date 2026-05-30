/**
 * @file deploy plugin — init/scaffold orchestrator (wrangler.jsonc + optional
 * GitHub Actions workflow, with idempotent write + drift-check modes).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateGithubWorkflow } from "./generators/github-workflow";
import { generateWranglerConfig, readWranglerConfig } from "./generators/wrangler-config";
import type { Config, DeployInitOptions, InitResult } from "./types";

/** Relative path of the generated wrangler config. */
const WRANGLER_PATH = "wrangler.jsonc";

/** Relative path of the generated GitHub Actions workflow. */
const WORKFLOW_PATH = ".github/workflows/deploy.yml";

/**
 * Read a file relative to `cwd`, returning `null` when it does not exist.
 *
 * @param cwd - Project root.
 * @param relativePath - Path relative to `cwd`.
 * @returns The file contents, or `null` when absent.
 * @example
 * await readMaybe(process.cwd(), ".github/workflows/deploy.yml");
 */
async function readMaybe(cwd: string, relativePath: string): Promise<string | null> {
  try {
    return await readFile(path.join(cwd, relativePath), "utf8");
  } catch {
    // eslint-disable-next-line unicorn/no-null -- "absent" is modeled as null.
    return null;
  }
}

/**
 * Orchestrate scaffold generation: write `wrangler.jsonc` (and `deploy.yml` when
 * `ci`) from the derived slug + config. Never overwrites an existing
 * `wrangler.jsonc` (idempotent — re-running is a no-op). In `check` mode, writes
 * nothing and instead reports paths whose on-disk content differs from what would
 * be generated.
 *
 * @param input - The scaffold orchestration inputs.
 * @param input.config - Resolved deploy config (outDir, compatibilityDate, ci).
 * @param input.slug - Cloudflare project-name slug (from `toSlug(site.name())`).
 * @param input.cwd - Project root the scaffold files are written into.
 * @param input.options - Optional ci toggle and check (drift-only) mode.
 * @returns Which files were written, skipped, or would drift.
 * @example
 * await writeScaffolding({ config, slug: "my-site", cwd: process.cwd(), options: { ci: true } });
 */
export async function writeScaffolding(input: {
  config: Readonly<Config>;
  slug: string;
  cwd: string;
  options: DeployInitOptions;
}): Promise<InitResult> {
  const { config, slug, cwd, options } = input;
  const ci = options.ci ?? config.ci ?? false;
  const check = options.check ?? false;

  const wranglerContents = generateWranglerConfig({
    slug,
    outDir: config.outDir,
    compatibilityDate: config.compatibilityDate ?? "2024-01-01"
  });

  const result: InitResult = { written: [], skipped: [], drifted: [] };

  // wrangler.jsonc — idempotent: never overwritten.
  await reconcile({
    relativePath: WRANGLER_PATH,
    expected: wranglerContents,
    existing: await readWranglerConfig(cwd),
    cwd,
    check,
    result
  });

  // .github/workflows/deploy.yml — only when ci is enabled.
  if (ci) {
    const workflowContents = generateGithubWorkflow({ slug });
    await reconcile({
      relativePath: WORKFLOW_PATH,
      expected: workflowContents,
      existing: await readMaybe(cwd, WORKFLOW_PATH),
      cwd,
      check,
      result
    });
  }

  return result;
}

/**
 * Reconcile one scaffold file against disk: in check mode record drift, otherwise
 * skip an existing file or write a new one. Mutates the shared {@link InitResult}.
 *
 * @param input - The reconciliation inputs.
 * @param input.relativePath - Path (relative to cwd) of the scaffold file.
 * @param input.expected - The content the generator would write.
 * @param input.existing - The current on-disk content, or `null` when absent.
 * @param input.cwd - Project root the file is written into.
 * @param input.check - Drift-only mode (writes nothing).
 * @param input.result - The accumulating init result to mutate.
 * @returns Resolves once the file has been reconciled.
 * @example
 * await reconcile({ relativePath, expected, existing, cwd, check, result });
 */
async function reconcile(input: {
  relativePath: string;
  expected: string;
  existing: string | null;
  cwd: string;
  check: boolean;
  result: InitResult;
}): Promise<void> {
  const { relativePath, expected, existing, cwd, check, result } = input;
  if (check) {
    if (existing !== null && existing !== expected) result.drifted.push(relativePath);
    return;
  }
  if (existing !== null) {
    result.skipped.push(relativePath);
    return;
  }
  await mkdir(path.dirname(path.join(cwd, relativePath)), { recursive: true });
  await writeFile(path.join(cwd, relativePath), expected, "utf8");
  result.written.push(relativePath);
}
