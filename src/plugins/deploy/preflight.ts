/**
 * @file deploy plugin — preflight validators (cheap → expensive), run in order
 * and short-circuiting on the first failure.
 */
import type { Dirent } from "node:fs";
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
 * Fold one directory entry into the running walk: queue subdirectories, and for
 * files bump the count and flag the path when it breaches the per-file size cap.
 *
 * @param entry - The directory entry being visited.
 * @param entryPath - The absolute path of `entry`.
 * @param result - The running walk aggregate, mutated in place.
 * @param stack - The pending-directory stack, pushed to for subdirectories.
 * @returns Resolves once the entry has been folded into `result`/`stack`.
 * @example
 * await inspectEntry(entry, "/project/dist/app.js", result, stack);
 */
async function inspectEntry(
  entry: Dirent,
  entryPath: string,
  result: OutdirStats,
  stack: string[]
): Promise<void> {
  // Subdirectories are deferred onto the walk stack for a later iteration.
  if (entry.isDirectory()) {
    stack.push(entryPath);
    return;
  }

  // Non-file entries (symlinks, sockets, …) are neither counted nor sized.
  if (!entry.isFile()) return;

  // Count the file, then flag it if it breaches the per-file size cap.
  result.fileCount += 1;
  const info = await stat(entryPath);
  const isOversize = info.size > MAX_FILE_SIZE_BYTES;
  if (isOversize) result.oversizePath = entryPath;
}

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
  // Seed the aggregate ("no oversize file" is modeled as null) and the walk stack.
  // eslint-disable-next-line unicorn/no-null -- "no oversize file" is modeled as null.
  const result: OutdirStats = { fileCount: 0, oversizePath: null };
  const stack: string[] = [dir];

  // Drain the stack one directory at a time, stopping early once an oversize file appears.
  while (stack.length > 0 && result.oversizePath === null) {
    const current = stack.pop();
    if (current === undefined) break;

    // Fold each child entry into the aggregate (files counted/sized, dirs queued).
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      await inspectEntry(entry, path.join(current, entry.name), result, stack);

      // Short-circuit the walk on the first oversize file found.
      if (result.oversizePath !== null) break;
    }
  }

  return result;
}

/**
 * Assert that `wrangler.jsonc` exists at the project root (cheap stat), throwing
 * the scaffolding hint if it is missing.
 *
 * @param root - Absolute project root the config is expected at.
 * @returns Resolves when `wrangler.jsonc` is present.
 * @throws {Error} `ERR_DEPLOY_NO_WRANGLER_CONFIG` when the file is absent.
 * @example
 * await checkWranglerConfig("/project");
 */
async function checkWranglerConfig(root: string): Promise<void> {
  try {
    await stat(path.join(root, "wrangler.jsonc"));
  } catch {
    throw deployError(
      "ERR_DEPLOY_NO_WRANGLER_CONFIG",
      `${ERROR_PREFIX}: wrangler.jsonc not found.\n  Run \`app.deploy.init()\` to scaffold it, then retry.`
    );
  }
}

/**
 * Assert that the walked outDir is non-empty, throwing the build-first hint when
 * it has no files.
 *
 * @param stats - The outDir walk aggregate from {@link inspectOutdir}.
 * @param outDir - The configured outDir (used verbatim in the error message).
 * @throws {Error} `ERR_DEPLOY_EMPTY_OUTDIR` when the outDir contains no files.
 * @example
 * checkOutdirNonEmpty({ fileCount: 12, oversizePath: null }, "dist");
 */
function checkOutdirNonEmpty(stats: OutdirStats, outDir: string): void {
  if (stats.fileCount === 0) {
    throw deployError(
      "ERR_DEPLOY_EMPTY_OUTDIR",
      `${ERROR_PREFIX}: outDir ${JSON.stringify(outDir)} is empty — nothing to deploy.`
    );
  }
}

/**
 * Assert that the outDir file count is within the effective (env-overridable)
 * tier limit, throwing the raise-the-cap hint when it overflows.
 *
 * @param fileCount - The number of files found in the outDir walk.
 * @param env - Environment used to resolve the file-limit override.
 * @throws {Error} `ERR_DEPLOY_TOO_MANY_FILES` when the count exceeds the limit.
 * @example
 * checkFileCount(150, { MOKU_DEPLOY_MAX_FILES: "100000" });
 */
function checkFileCount(fileCount: number, env: NodeJS.ProcessEnv): void {
  const limit = resolveFileLimit(env);
  if (fileCount > limit) {
    throw deployError(
      "ERR_DEPLOY_TOO_MANY_FILES",
      `${ERROR_PREFIX}: outDir contains ${fileCount} files; the limit is ${limit}.\n  Raise it with ${MAX_FILES_ENV} (paid tier) or reduce the output.`
    );
  }
}

/**
 * Assert that no single file exceeded the per-file size cap, throwing for the
 * first oversize path flagged by the walk.
 *
 * @param oversizePath - The first oversize file path, or null when none.
 * @throws {Error} `ERR_DEPLOY_FILE_TOO_LARGE` when an oversize file exists.
 * @example
 * checkFileSize(null);
 */
function checkFileSize(oversizePath: string | null): void {
  if (oversizePath !== null) {
    throw deployError(
      "ERR_DEPLOY_FILE_TOO_LARGE",
      `${ERROR_PREFIX}: file ${JSON.stringify(oversizePath)} exceeds the 25 MiB per-file limit.`
    );
  }
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
  await checkWranglerConfig(root);

  // 2. outDir exists (walkable) and is non-empty.
  const outDirAbs = path.isAbsolute(config.outDir)
    ? path.resolve(config.outDir)
    : path.resolve(root, config.outDir);
  const stats = await inspectOutdir(outDirAbs).catch(() => {
    throw deployError(
      "ERR_DEPLOY_EMPTY_OUTDIR",
      `${ERROR_PREFIX}: outDir ${JSON.stringify(config.outDir)} is missing.\n  Run your build first, then retry.`
    );
  });
  checkOutdirNonEmpty(stats, config.outDir);

  // 3. File count within the tier limit (env-overridable).
  checkFileCount(stats.fileCount, env);

  // 4. No single file over the per-file size cap.
  checkFileSize(stats.oversizePath);
}
