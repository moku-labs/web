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
import { BUNDLE_FILE, relativeDataFile } from "./convention";
import type { DataEntry, DataWriteSummary } from "./types";

/** Default build output root, matching build's default `outDir` ("./dist", build/api.ts). */
const DEFAULT_OUT_DIR = "./dist";
/** Concurrency bound for per-page JSON writes. */
const WRITE_CONCURRENCY = 8;

/**
 * Persist one entry's data as JSON under `<outDir>/<relativeDataFile>` and return
 * the written `{ relative, bytes }`.
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
  // Mirror the page URL into its `outDir`-relative JSON path.
  const relative = relativeDataFile(outputDir, entry.path);
  const filePath = path.join(outDir, relative);

  // Ensure the parent directory exists before writing.
  await mkdir(path.dirname(filePath), { recursive: true });

  // Serialize the entry's data and write it as one JSON file.
  const body = JSON.stringify(entry.data);
  await writeFile(filePath, body, "utf8");

  // Report the written file's relative path and byte length.
  return { relative, bytes: Buffer.byteLength(body, "utf8") };
}

/**
 * Roll up the per-file write records into the public {@link DataWriteSummary}:
 * file count, total byte length, and the `outDir`-relative paths in write order.
 *
 * @param written - The per-file `{ relative, bytes }` records from {@link writeEntry}.
 * @returns The aggregated write summary.
 * @example
 * ```ts
 * compileSummary([{ relative: "_data/en/hello/index.json", bytes: 12 }]);
 * ```
 */
function compileSummary(written: readonly { relative: string; bytes: number }[]): DataWriteSummary {
  return {
    fileCount: written.length,
    bytes: written.reduce((total, file) => total + file.bytes, 0),
    files: written.map(file => file.relative)
  };
}

/**
 * Persist the preload bundle: one JSON object `{ "<page path>": data }` keyed by
 * each entry's `path`, exactly the key `at(path)` caches under. A later entry for
 * the same path wins, like the per-page file it overwrites.
 *
 * @param entries - The per-page data to bundle.
 * @param outDir - The build output root.
 * @param outputDir - The configured data output subdir.
 * @returns The written bundle's `outDir`-relative path and byte length.
 * @example
 * ```ts
 * await writeBundle([{ path: "/en/hello/", data }], "./dist", "_data");
 * ```
 */
async function writeBundle(
  entries: readonly DataEntry[],
  outDir: string,
  outputDir: string
): Promise<{ file: string; bytes: number }> {
  const bundle: Record<string, unknown> = {};
  for (const entry of entries) bundle[entry.path] = entry.data;

  const file = `${outputDir.endsWith("/") ? outputDir.slice(0, -1) : outputDir}/${BUNDLE_FILE}`;
  const filePath = path.join(outDir, file);
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = JSON.stringify(bundle);
  await writeFile(filePath, body, "utf8");
  return { file, bytes: Buffer.byteLength(body, "utf8") };
}

/**
 * The Node write side of the provider. Persists one JSON file per entry (bounded
 * by `p-limit`) — domain-agnostic, no route expansion (`build` already did that).
 * With `preload: "all"` it also writes the bundle file (see {@link writeBundle}).
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
  // Resolve the output root, falling back to build's default when unset.
  const outDir = options?.outDir ?? DEFAULT_OUT_DIR;

  // Persist one JSON file per entry, bounded by the write-concurrency limiter.
  const limit = pLimit(WRITE_CONCURRENCY);
  const written = await Promise.all(
    entries.map(entry => limit(() => writeEntry(entry, outDir, ctx.config.outputDir)))
  );

  // Roll up the per-file records and record the summary on state.
  const summary = compileSummary(written);
  if (ctx.config.preload === "all") {
    summary.bundle = await writeBundle(entries, outDir, ctx.config.outputDir);
  }
  ctx.state.lastWrite = summary;
  return summary;
}
