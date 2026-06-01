/**
 * @file data plugin — Node write side of the agnostic provider (`write()`).
 *
 * This is the ONLY module in the `data` plugin that touches `node:*`. It is
 * reached exclusively through a lazy `await import("./writer")` inside `api.ts`'s
 * `write()`, so a browser bundle that composes `data` for the read side never
 * statically pulls `node:fs` (see `__tests__/unit/isolation.test.ts`).
 *
 * It is domain-agnostic: it persists whatever `data` each {@link DataEntry} carries
 * (the route's own `load`/projection output — `build` produced these), one JSON
 * file per page, at the path {@link dataSuffix} mirrors from the page URL. No
 * content/article knowledge, no expansion (build already expanded the routes).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import type { DataPluginContext } from "./api";
import { dataSuffix } from "./convention";
import type { DataEntry, DataWriteSummary } from "./types";

/** Default build output root, matching `build`'s `defaultBuildConfig.outDir`. */
const DEFAULT_OUT_DIR = "./dist";
/** Concurrency bound for per-page writes (matches the OG-image phase's pool). */
const WRITE_CONCURRENCY = 8;

/**
 * Resolve the `outDir`-relative file for a page path using the shared convention,
 * trimming a trailing slash from the config dir so the join stays clean.
 *
 * @param outputDir - The configured data output subdir (e.g. `"_data"`).
 * @param pagePath - The page URL path (e.g. `/en/hello/`).
 * @returns The `outDir`-relative file path (e.g. `_data/en/hello/index.json`).
 * @example
 * ```ts
 * relativeFile("_data", "/en/hello/"); // "_data/en/hello/index.json"
 * ```
 */
function relativeFile(outputDir: string, pagePath: string): string {
  const dir = outputDir.endsWith("/") ? outputDir.slice(0, -1) : outputDir;
  return `${dir}/${dataSuffix(pagePath)}`;
}

/**
 * Persist one entry's data as JSON under `<outDir>/<relativeFile>` and return the
 * written `{ relative, bytes }`.
 *
 * @param entry - The page entry to persist.
 * @param outDir - The build output root.
 * @param outputDir - The configured data output subdir.
 * @returns The written file's `outDir`-relative path and byte length.
 * @example
 * ```ts
 * await writeEntry({ path: "/en/hello/", data }, "./dist", "_data");
 * ```
 */
async function writeEntry(
  entry: DataEntry,
  outDir: string,
  outputDir: string
): Promise<{ relative: string; bytes: number }> {
  const relative = relativeFile(outputDir, entry.path);
  const filePath = path.join(outDir, relative);
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = JSON.stringify(entry.data);
  await writeFile(filePath, body, "utf8");
  return { relative, bytes: Buffer.byteLength(body, "utf8") };
}

/**
 * The Node write side of the provider. Persists one JSON file per entry (bounded
 * by `p-limit`) — domain-agnostic, no route expansion (`build` already did that).
 * Records the summary in `ctx.state.lastWrite`.
 *
 * @param ctx - The data plugin context (state, config).
 * @param entries - The per-page data to persist.
 * @param options - Optional overrides.
 * @param options.outDir - Build output directory to write under (default `./dist`).
 * @returns A summary of the written files.
 * @example
 * ```ts
 * const summary = await writeData(ctx, [{ path: "/en/hello/", data }], { outDir: "./dist" });
 * ```
 */
export async function writeData(
  ctx: DataPluginContext,
  entries: readonly DataEntry[],
  options?: { outDir?: string }
): Promise<DataWriteSummary> {
  const outDir = options?.outDir ?? DEFAULT_OUT_DIR;
  const limit = pLimit(WRITE_CONCURRENCY);
  const written = await Promise.all(
    entries.map(entry => limit(() => writeEntry(entry, outDir, ctx.config.outputDir)))
  );
  const summary: DataWriteSummary = {
    fileCount: written.length,
    bytes: written.reduce((total, file) => total + file.bytes, 0),
    files: written.map(file => file.relative)
  };
  ctx.state.lastWrite = summary;
  return summary;
}
