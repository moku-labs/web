/**
 * @file build phase 1 — bundle. Runs `Bun.build` for CSS and JS separately into
 * outDir (honoring `config.minify`); caches hashed asset paths for the pages phase.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { BuildCacheEntry, PhaseContext } from "../types";

/** Conventional CSS entry candidates (project-relative). */
const CSS_ENTRY_CANDIDATES = ["src/client/styles.css", "src/styles/main.css"] as const;
/** Conventional JS entry candidates (project-relative). */
const JS_ENTRY_CANDIDATES = ["src/client/main.ts", "src/client/main.tsx", "src/main.ts"] as const;

/**
 * Minimal structural view of a single `Bun.build` artifact (only the fields the
 * bundle phase records). Kept narrow so the runner is easy to fake in tests.
 *
 * @example
 * ```ts
 * const artifact: BuildArtifact = { path: "out/main-abc123.js", kind: "entry-point" };
 * ```
 */
export type BuildArtifact = {
  /** The on-disk (hashed) output path of the artifact. */
  readonly path: string;
  /** The artifact kind reported by the bundler. */
  readonly kind?: string;
};

/**
 * Structural view of a `Bun.build` result (the subset the bundle phase reads).
 *
 * @example
 * ```ts
 * const result: BuildRunnerResult = { success: true, outputs: [] };
 * ```
 */
export type BuildRunnerResult = {
  /** Whether the build succeeded. */
  readonly success: boolean;
  /** The produced artifacts (entry points first). */
  readonly outputs: readonly BuildArtifact[];
};

/**
 * Injectable bundler runner. Defaults to `Bun.build`; unit tests inject a fake to
 * assert the entrypoints + `minify` flag without invoking the real bundler.
 *
 * @example
 * ```ts
 * const runner: BundleRunner = async () => ({ success: true, outputs: [] });
 * ```
 */
export type BundleRunner = (options: {
  /** Entry files for this build. */
  entrypoints: string[];
  /** Output directory. */
  outdir: string;
  /** Whether to minify. */
  minify: boolean;
}) => Promise<BuildRunnerResult>;

/**
 * The optional dependency-injection seam for {@link bundle}.
 *
 * @example
 * ```ts
 * await bundle(ctx, { runner, cssEntrypoints: ["a.css"], jsEntrypoints: ["b.ts"] });
 * ```
 */
export type BundleOptions = {
  /** Override the bundler runner (defaults to `Bun.build`). */
  runner?: BundleRunner;
  /** Override the resolved CSS entrypoints (defaults to the conventional scan). */
  cssEntrypoints?: string[];
  /** Override the resolved JS entrypoints (defaults to the conventional scan). */
  jsEntrypoints?: string[];
};

/**
 * The default bundler runner — adapts the built-in `Bun.build`.
 *
 * @param options - Entry/outdir/minify settings forwarded to `Bun.build`.
 * @param options.entrypoints - Entry files for this build.
 * @param options.outdir - Output directory.
 * @param options.minify - Whether to minify.
 * @returns The structural build result.
 * @example
 * ```ts
 * await defaultRunner({ entrypoints: ["a.css"], outdir: "dist", minify: true });
 * ```
 */
async function defaultRunner(options: {
  entrypoints: string[];
  outdir: string;
  minify: boolean;
}): Promise<BuildRunnerResult> {
  const bun = (globalThis as { Bun?: { build: BundleRunner } }).Bun;
  if (!bun) {
    return { success: false, outputs: [] };
  }
  return bun.build(options);
}

/**
 * Resolve the first existing entry file from a candidate list (project-relative).
 *
 * @param candidates - Ordered candidate paths to probe.
 * @returns A one-element entrypoint array when found, else an empty array.
 * @example
 * ```ts
 * resolveEntrypoints(["src/main.ts"]);
 * ```
 */
function resolveEntrypoints(candidates: readonly string[]): string[] {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return [candidate];
  }
  return [];
}

/**
 * Resolve the authoritative JS client entrypoint (#8): when `config.clientEntry` is
 * set, use it directly (the authoritative override); otherwise fall back to the
 * conventional candidate scan. When neither yields an entry, `ctx.log.warn` (no
 * client bundle is produced) and an empty list is returned.
 *
 * @param ctx - Plugin context (provides `config`, `log`).
 * @returns The resolved JS entrypoint list (possibly empty).
 * @example
 * ```ts
 * resolveJsEntrypoints(ctx);
 * ```
 */
function resolveJsEntrypoints(ctx: Pick<PhaseContext, "config" | "log">): string[] {
  const { clientEntry } = ctx.config;
  const isClientEntrySet = typeof clientEntry === "string" && clientEntry.length > 0;
  if (isClientEntrySet) return [clientEntry];
  const scanned = resolveEntrypoints(JS_ENTRY_CANDIDATES);
  if (scanned.length === 0) {
    ctx.log.warn("build:bundle", { clientEntry: "none", scanned: JS_ENTRY_CANDIDATES });
  }
  return scanned;
}

/**
 * Convert an artifact's on-disk path into the web URL the page phase will embed:
 * relative to the publish root with POSIX separators (e.g. "assets/main-abc123.css"),
 * which `buildAssetTags` then prefixes with "/". `Bun.build` reports absolute output
 * paths, so embedding `output.path` verbatim would yield a broken protocol-relative
 * URL like "//Users/.../main.css" — relativizing against `outDir` is what keeps it
 * a site-rooted path.
 *
 * @param absolutePath - The artifact's on-disk output path (may be absolute).
 * @param outDir - The publish root the web path is relativized against.
 * @returns The publish-root-relative path with forward-slash separators.
 * @example
 * ```ts
 * normalizeAssetPath("/abs/dist/assets/main-abc123.css", "dist"); // "assets/main-abc123.css"
 * ```
 */
function normalizeAssetPath(absolutePath: string, outDir: string): string {
  return path.relative(path.resolve(outDir), path.resolve(absolutePath)).split(path.sep).join("/");
}

/**
 * Run one bundler pass for a single asset kind and record the hashed output
 * paths under `state.buildCache` keyed by the original entry basename.
 *
 * @param ctx - The phase context (state + log).
 * @param runner - The bundler runner to invoke.
 * @param kind - The asset kind label (`"css"` / `"js"`) — used as the cache key.
 * @param entrypoints - Resolved entry files (skipped when empty).
 * @param outDir - The publish root; stored asset paths are made relative to it.
 * @param outdir - The bundler output directory (`<outDir>/assets`).
 * @param minify - Whether to minify.
 * @example
 * ```ts
 * await runOne(ctx, runner, "css", ["a.css"], "dist", true);
 * ```
 */
async function runOne(
  ctx: Pick<PhaseContext, "state" | "log">,
  runner: BundleRunner,
  kind: "css" | "js",
  entrypoints: string[],
  outDir: string,
  outdir: string,
  minify: boolean
): Promise<void> {
  // Nothing to bundle for this kind — skip the pass entirely.
  if (entrypoints.length === 0) return;

  // Run the bundler pass; a failed build aborts the whole phase.
  const result = await runner({ entrypoints, outdir, minify });
  if (!result.success) {
    throw new Error(`[web] build.bundle ${kind} build failed`);
  }

  // Map each hashed artifact basename to its embeddable web path.
  const hashed: BuildCacheEntry = {};
  for (const output of result.outputs) {
    hashed[path.basename(output.path)] = normalizeAssetPath(output.path, outDir);
  }

  // Publish the kind's asset map for downstream phases and record the count.
  ctx.state.buildCache.set(kind, hashed);
  ctx.log.debug("build:bundle", { kind, count: result.outputs.length });
}

/**
 * Bundles CSS and JS into the output directory via two separate runner passes
 * (dodging Bun's mixed-entrypoint segfault), honoring `config.minify`, and caches
 * the resulting hashed asset paths in `state.buildCache` for downstream phases.
 *
 * @param ctx - Plugin context (provides `state`, `config`, `log`).
 * @param options - Optional dependency-injection seam (runner + entrypoints).
 * @returns A promise resolving once both bundle passes complete.
 * @example
 * ```ts
 * await bundle(ctx);
 * ```
 */
export async function bundle(
  ctx: Pick<PhaseContext, "state" | "config" | "log">,
  options: BundleOptions = {}
): Promise<void> {
  const runner = options.runner ?? defaultRunner;
  const { minify, outDir } = ctx.config;
  const cssEntrypoints = options.cssEntrypoints ?? resolveEntrypoints(CSS_ENTRY_CANDIDATES);
  const jsEntrypoints = options.jsEntrypoints ?? resolveJsEntrypoints(ctx);
  await runOne(ctx, runner, "css", cssEntrypoints, outDir, path.join(outDir, "assets"), minify);
  await runOne(ctx, runner, "js", jsEntrypoints, outDir, path.join(outDir, "assets"), minify);
}
