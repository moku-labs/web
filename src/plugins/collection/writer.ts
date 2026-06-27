/**
 * @file collection plugin — Node write side of the provider (`write()`).
 *
 * This is the ONLY module in the `collection` plugin that touches `node:*`. It is
 * reached exclusively through a lazy `await import("./writer")` inside `api.ts`'s
 * `write()`, so a browser bundle that composes `collection` for the read side never
 * statically pulls `node:fs` (see `__tests__/unit/isolation.test.ts`).
 *
 * It is domain-agnostic: it persists whatever `data` each {@link CollectionShard}
 * carries (the build authored these), one JSON file per shard, at the path
 * {@link relativeShardFile} derives from `(collection, shard)`. No domain knowledge,
 * no expansion (build already authored the shards).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import type { CollectionPluginContext } from "./api";
import { relativeShardFile } from "./convention";
import type { CollectionShard, CollectionWriteSummary } from "./types";

/** Default build output root, matching build's default `outDir` ("./dist", build/api.ts). */
const DEFAULT_OUT_DIR = "./dist";
/** Concurrency bound for per-shard JSON writes. */
const WRITE_CONCURRENCY = 8;

/**
 * Persist one shard's data as JSON under `<outDir>/<relativeShardFile>` and return
 * the written `{ relative, bytes }`.
 *
 * @param entry - The shard entry to persist.
 * @param outDir - The build output root.
 * @returns The written file's `outDir`-relative path and byte length.
 * @example
 * ```ts
 * await writeEntry({ collection: "bank", shard: "en/animals", data }, "./dist");
 * ```
 */
async function writeEntry(
  entry: CollectionShard,
  outDir: string
): Promise<{ relative: string; bytes: number }> {
  // Derive the `(collection, shard)` key into its `outDir`-relative JSON path.
  const relative = relativeShardFile(entry.collection, entry.shard);
  const filePath = path.join(outDir, relative);

  // Ensure the parent directory exists before writing.
  await mkdir(path.dirname(filePath), { recursive: true });

  // Serialize the shard's data and write it as one JSON file.
  const body = JSON.stringify(entry.data);
  await writeFile(filePath, body, "utf8");

  // Report the written file's relative path and byte length.
  return { relative, bytes: Buffer.byteLength(body, "utf8") };
}

/**
 * Roll up the per-file write records into the public {@link CollectionWriteSummary}:
 * file count, total byte length, and the `outDir`-relative paths in write order.
 *
 * @param written - The per-file `{ relative, bytes }` records from {@link writeEntry}.
 * @returns The aggregated write summary.
 * @example
 * ```ts
 * compileSummary([{ relative: "bank/en/animals.json", bytes: 12 }]);
 * ```
 */
function compileSummary(
  written: readonly { relative: string; bytes: number }[]
): CollectionWriteSummary {
  return {
    fileCount: written.length,
    bytes: written.reduce((total, file) => total + file.bytes, 0),
    files: written.map(file => file.relative)
  };
}

/**
 * The Node write side of the provider. Persists one JSON file per shard (bounded
 * by `p-limit`) — domain-agnostic, no expansion (`build` already authored the
 * shards). Records the summary in `ctx.state.lastWrite`.
 *
 * @param ctx - The collection plugin context (state, config).
 * @param entries - The per-shard data to persist.
 * @param options - Optional overrides.
 * @param options.outDir - Build output directory to write under (default `./dist`).
 * @returns A summary of the written files.
 * @example
 * ```ts
 * const summary = await writeCollection(ctx, [{ collection: "bank", shard: "ru", data }]);
 * ```
 */
export async function writeCollection(
  ctx: CollectionPluginContext,
  entries: readonly CollectionShard[],
  options?: { outDir?: string }
): Promise<CollectionWriteSummary> {
  // Resolve the output root, falling back to build's default when unset.
  const outDir = options?.outDir ?? DEFAULT_OUT_DIR;

  // Persist one JSON file per shard, bounded by the write-concurrency limiter.
  const limit = pLimit(WRITE_CONCURRENCY);
  const written = await Promise.all(entries.map(entry => limit(() => writeEntry(entry, outDir))));

  // Roll up the per-file records and record the summary on state.
  const summary = compileSummary(written);
  ctx.state.lastWrite = summary;
  return summary;
}
