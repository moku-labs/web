/**
 * @file deploy plugin — preflight validators (cheap → expensive), run in order
 * and short-circuiting on the first failure.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Config } from "./types";
import { deployError } from "./wrangler";

/** Error prefix for deploy preflight failures (spec/11 Part-3). */
const ERROR_PREFIX = "[web] deploy";

/** Cloudflare Pages free-tier file-count limit. */
const FREE_TIER_FILE_LIMIT = 20_000;

/** Cloudflare Pages paid-tier file-count limit (env override target). */
const PAID_TIER_FILE_LIMIT = 100_000;

/** Per-file size cap for Cloudflare Pages (25 MiB). */
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/** Env var that raises the file-count cap from the free tier to the paid tier. */
const MAX_FILES_ENV = "MOKU_DEPLOY_MAX_FILES";

/**
 * Resolve the effective file-count limit, honoring the documented env override.
 *
 * @param env - The environment to read the override from (defaults to process.env).
 * @returns The effective file-count cap.
 * @example
 * resolveFileLimit({ MOKU_DEPLOY_MAX_FILES: "100000" }); // 100000
 */
export function resolveFileLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[MAX_FILES_ENV];
  if (raw === undefined || raw === "") return FREE_TIER_FILE_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return FREE_TIER_FILE_LIMIT;
  return Math.min(parsed, PAID_TIER_FILE_LIMIT);
}

/** Aggregate of a recursive outDir walk. */
type OutdirStats = { fileCount: number; oversizePath: string | null };

/**
 * Recursively walk `dir`, counting files and flagging the first file over the
 * per-file size cap. Short-circuits once an oversize file is found.
 *
 * @param dir - Absolute directory to inspect.
 * @returns The file count and the first oversize path (or null).
 * @example
 * await inspectOutdir("/project/dist");
 */
export async function inspectOutdir(dir: string): Promise<OutdirStats> {
  // eslint-disable-next-line unicorn/no-null -- "no oversize file" is modeled as null.
  const result: OutdirStats = { fileCount: 0, oversizePath: null };
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        result.fileCount += 1;
        const info = await stat(entryPath);
        if (info.size > MAX_FILE_SIZE_BYTES) {
          result.oversizePath = entryPath;
          return result;
        }
      }
    }
  }
  return result;
}

/**
 * Run the deploy preflight validators in cheap → expensive order, throwing a
 * coded deploy error on the first failure:
 * 1. wrangler.jsonc exists, 2. outDir exists and is non-empty,
 * 3. file count ≤ limit (env-overridable), 4. no single file > 25 MiB.
 *
 * @param config - Resolved deploy config (provides outDir).
 * @param root - Absolute project root the outDir is resolved against.
 * @param env - Environment used for the file-limit override (defaults to process.env).
 * @returns Resolves when all preflight checks pass.
 * @throws {Error} With a deploy `code` on the first failing check.
 * @example
 * await runPreflight(config, process.cwd());
 */
export async function runPreflight(
  config: Readonly<Config>,
  root: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  // 1. wrangler.jsonc exists (cheap stat).
  const wranglerPath = path.join(root, "wrangler.jsonc");
  try {
    await stat(wranglerPath);
  } catch {
    throw deployError(
      "ERR_DEPLOY_NO_WRANGLER_CONFIG",
      `${ERROR_PREFIX}: wrangler.jsonc not found.\n  Run \`app.deploy.init()\` to scaffold it, then retry.`
    );
  }

  // 2. outDir exists and is non-empty.
  const outDirAbs = path.isAbsolute(config.outDir)
    ? path.resolve(config.outDir)
    : path.resolve(root, config.outDir);
  const stats = await inspectOutdir(outDirAbs).catch(() => {
    throw deployError(
      "ERR_DEPLOY_EMPTY_OUTDIR",
      `${ERROR_PREFIX}: outDir ${JSON.stringify(config.outDir)} is missing.\n  Run your build first, then retry.`
    );
  });
  if (stats.fileCount === 0) {
    throw deployError(
      "ERR_DEPLOY_EMPTY_OUTDIR",
      `${ERROR_PREFIX}: outDir ${JSON.stringify(config.outDir)} is empty — nothing to deploy.`
    );
  }

  // 3. File count within the tier limit (env-overridable).
  const limit = resolveFileLimit(env);
  if (stats.fileCount > limit) {
    throw deployError(
      "ERR_DEPLOY_TOO_MANY_FILES",
      `${ERROR_PREFIX}: outDir contains ${stats.fileCount} files; the limit is ${limit}.\n  Raise it with ${MAX_FILES_ENV} (paid tier) or reduce the output.`
    );
  }

  // 4. No single file over the per-file size cap.
  if (stats.oversizePath !== null) {
    throw deployError(
      "ERR_DEPLOY_FILE_TOO_LARGE",
      `${ERROR_PREFIX}: file ${JSON.stringify(stats.oversizePath)} exceeds the 25 MiB per-file limit.`
    );
  }
}
