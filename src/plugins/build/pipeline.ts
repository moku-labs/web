/**
 * @file build plugin — pipeline driver. Sequences the fixed multi-phase build,
 * emits `build:phase` boundaries, and runs intra-phase work via `Promise.all`.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { bundle } from "./phases/bundle";
import { generateCacheHeaders } from "./phases/cache-headers";
import { loadContent } from "./phases/content";
import { copyContentImages } from "./phases/content-images";
import { generateFeeds } from "./phases/feeds";
import { processImages } from "./phases/images";
import { generateLocaleRedirects } from "./phases/locale-redirects";
import { generateNotFound } from "./phases/not-found";
import { generateOgImages } from "./phases/og-images";
import { renderPages } from "./phases/pages";
import { copyPublic, DEFAULT_PUBLIC_DIR } from "./phases/public";
import { generateSitemap } from "./phases/sitemap";
import type { BuildResult, PhaseContext, PhaseName, RunOptions } from "./types";

/** Error prefix for build pipeline runtime failures (spec/11 Part-3). */
const ERROR_PREFIX = "[web] build";

/** Matches a Markdown source path (a content edit). */
const MARKDOWN_PATH = /\.md$/;
/** Matches a stylesheet path (a CSS edit — does not change rendered page bodies). */
const STYLE_PATH = /\.css$/;
/** Matches a code path (TS/JS/JSON — may change ANY page's render output). */
const CODE_PATH = /\.(?:tsx?|jsx?|mjs|cjs|json)$/;

/**
 * What a dev rebuild may safely reuse, derived from the set of changed paths. A full
 * build (no `changed`) reuses nothing. If every change is a classified content/style/code
 * edit, content (unaffected by style/code edits) is reusable, and page renders are
 * reusable when NO code changed (code can change any page's output). Any unclassifiable
 * path (a bare directory, an unknown extension, a platform that reported no filename)
 * conservatively forces a full rebuild — correctness over speed.
 *
 * @example
 * ```ts
 * planIncrementalRebuild(["/c/intro/en.md"]); // { contentChanged: [...], contentReuse: true, renderReuse: true }
 * ```
 */
export type ChangePlan = {
  /** Changed Markdown paths to invalidate before loading content (slug-derived). */
  contentChanged: readonly string[];
  /** Reuse cached content for slugs not invalidated (every change is classified). */
  contentReuse: boolean;
  /** Reuse cached page renders for pages whose data is unchanged (no code changed). */
  renderReuse: boolean;
};

/**
 * Derive the {@link ChangePlan} for a run from its changed-path set (see the type docs
 * for the rules).
 *
 * @param changed - Absolute/relative changed paths, or `undefined` for a full build.
 * @returns The reuse plan for this run.
 * @example
 * ```ts
 * const plan = planIncrementalRebuild(options?.changed);
 * ```
 */
export function planIncrementalRebuild(changed: readonly string[] | undefined): ChangePlan {
  // No changed set (initial / production build) → re-read + re-render everything.
  if (changed === undefined || changed.length === 0) {
    return { contentChanged: [], contentReuse: false, renderReuse: false };
  }
  // Any path we cannot classify means we do not know what changed → full rebuild.
  const allClassified = changed.every(
    file => MARKDOWN_PATH.test(file) || STYLE_PATH.test(file) || CODE_PATH.test(file)
  );
  if (!allClassified) {
    return { contentChanged: [], contentReuse: false, renderReuse: false };
  }
  // Content survives style/code edits; renders survive only style + content edits.
  const contentChanged = changed.filter(file => MARKDOWN_PATH.test(file));
  const codeChanged = changed.some(file => CODE_PATH.test(file));
  return { contentChanged, contentReuse: true, renderReuse: !codeChanged };
}

/**
 * Test whether a resolved path sits STRICTLY inside a resolved base directory —
 * equality does not count (the base itself is never "inside" itself).
 *
 * @param resolved - The resolved absolute candidate path.
 * @param baseResolved - The resolved absolute base directory.
 * @returns `true` when `resolved` is nested beneath `baseResolved`.
 * @example
 * ```ts
 * isStrictlyInside("/app/dist", "/app"); // true — but isStrictlyInside("/app", "/app") is false
 * ```
 */
function isStrictlyInside(resolved: string, baseResolved: string): boolean {
  return resolved !== baseResolved && resolved.startsWith(baseResolved + path.sep);
}

/**
 * Assert that `outDir` is a SAFE target for the clean phase's recursive force-delete,
 * defending against a misconfiguration (`outDir: "/"`, `"."`, `"~"`, a `..` escape)
 * that would otherwise wipe the filesystem root, the home directory, or the project
 * itself. Mirrors the deploy plugin's `assertWithinRoot` posture, tightened for
 * deletion: a target is safe only when it sits STRICTLY inside the project root
 * (never the root itself) or strictly inside the OS temp directory (a disposable
 * area, used by preview/test builds) — and is never the home directory.
 *
 * @param outDir - The configured output directory (relative or absolute).
 * @param root - The absolute project root relative paths resolve against.
 * @returns The resolved absolute output directory.
 * @throws {Error} `[web] build.outDir` when the resolved target is unsafe to delete.
 * @example
 * ```ts
 * assertSafeCleanTarget("./dist", process.cwd()); // "<cwd>/dist"
 * ```
 */
export function assertSafeCleanTarget(outDir: string, root: string): string {
  const resolved = path.isAbsolute(outDir) ? path.resolve(outDir) : path.resolve(root, outDir);
  const rootResolved = path.resolve(root);

  // The home directory is never a clean target, even when the build (unusually)
  // runs from an ancestor of it — deleting it loses far more than a stale build.
  const isHome = resolved === path.resolve(homedir());

  // Safe targets sit strictly inside the project (the usual `./dist`) or strictly
  // inside the OS temp area (preview/test builds); the bases themselves never qualify.
  const isSafe =
    isStrictlyInside(resolved, rootResolved) || isStrictlyInside(resolved, path.resolve(tmpdir()));
  if (isSafe && !isHome) return resolved;

  throw new Error(
    `${ERROR_PREFIX}.outDir: ${JSON.stringify(outDir)} (resolves to ${JSON.stringify(resolved)}) is not a safe clean target.\n` +
      `  The clean phase force-deletes outDir recursively, so it must sit strictly inside the project root ${JSON.stringify(rootResolved)} (or the OS temp directory) — never the filesystem root, your home directory, or the project root itself.\n` +
      `  Point build.outDir at a directory inside the project, e.g. "./dist".`
  );
}

/**
 * The static ordered list of pipeline phase names.
 *
 * @example
 * ```ts
 * const first = PHASE_ORDER[0];
 * ```
 */
export const PHASE_ORDER: readonly PhaseName[] = [
  "bundle",
  "content",
  "images",
  "pages",
  "content-images",
  "feeds",
  "sitemap",
  "og-images",
  "public",
  "not-found",
  "locale-redirects",
  "cache-headers",
  "root-index"
] as const;

/**
 * Run one phase with `build:phase` start/done boundary emissions wrapping the work.
 *
 * @param ctx - The phase context (used to emit boundaries).
 * @param phase - The phase name for the boundary payloads.
 * @param work - The async phase body to execute between the boundaries.
 * @returns The phase body's resolved value.
 * @example
 * ```ts
 * await withPhase(ctx, "bundle", () => bundle(ctx));
 * ```
 */
async function withPhase<T>(
  ctx: Pick<PhaseContext, "emit">,
  phase: PhaseName,
  work: () => Promise<T>
): Promise<T> {
  ctx.emit("build:phase", { phase, status: "start" });
  const started = Date.now();
  const result = await work();
  ctx.emit("build:phase", { phase, status: "done", durationMs: Date.now() - started });
  return result;
}

/**
 * Reset the per-run state (manifest, buildCache, runId) and assign a fresh runId.
 * A clean run (no `skipClean`) also drops the OG image hash cache: the outDir wipe
 * deletes every `og/<slug>.png` the cache indexes, so honoring those warm entries
 * would skip rendering files that no longer exist. A `skipClean` (dev) run keeps
 * the cache — its PNGs survive on disk.
 *
 * @param ctx - The phase context whose `state` is reset.
 * @param options - The run options (only `skipClean` is consulted).
 * @example
 * ```ts
 * resetRun(ctx, options);
 * ```
 */
export function resetRun(
  ctx: Pick<PhaseContext, "state">,
  options?: Pick<RunOptions, "skipClean">
): void {
  // eslint-disable-next-line unicorn/no-null -- `manifest` is `RouteDefinition[] | null` until the pages phase populates it
  ctx.state.manifest = null;
  ctx.state.buildCache = new Map<string, unknown>();
  ctx.state.runId = `${Date.now()}-${randomUUID()}`;

  // The clean run below rm -rf's the outDir — the hash cache must not outlive its PNGs.
  if (!options?.skipClean) ctx.state.ogImageHashCache.clear();
}

/**
 * Report each rejected outcome from a settled output batch as a `build:outputs`
 * error, leaving fulfilled outcomes untouched (failures are isolated, not fatal).
 *
 * @param ctx - The phase context (used to log rejections).
 * @param settled - The settled results from the `runOutputs` task batch.
 * @example
 * ```ts
 * reportOutputFailures(ctx, await Promise.allSettled(tasks));
 * ```
 */
function reportOutputFailures(
  ctx: Pick<PhaseContext, "log">,
  settled: readonly PromiseSettledResult<unknown>[]
): void {
  for (const outcome of settled) {
    if (outcome.status !== "rejected") continue;
    ctx.log.error("build:outputs", { reason: String(outcome.reason) });
  }
}

/**
 * Phase 4 — run feeds / sitemap / og-images / public / not-found / locale-redirects
 * concurrently, each gated by its config flag (or, for `public`, the presence of the
 * source dir), isolated with `Promise.allSettled` so one failure does not lose the
 * others. A disabled output is skipped entirely — it emits NO `build:phase` boundary
 * (the `withPhase` wrapper is gated on the config flag, not just the phase body).
 *
 * Note: this boundary-gating applies only to these `runOutputs` tasks. The always-on
 * pipeline phases (`bundle`/`content`/`images`/`pages`/`content-images`/`root-index`,
 * run unconditionally in `runPipeline`) always emit their boundaries.
 *
 * @param ctx - The phase context.
 * @example
 * ```ts
 * await runOutputs(ctx);
 * ```
 */
async function runOutputs(ctx: PhaseContext): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  // Document outputs (feeds, sitemap, og-images) — each gated on its config flag.
  if (ctx.config.feeds) tasks.push(withPhase(ctx, "feeds", () => generateFeeds(ctx)));
  if (ctx.config.sitemap) tasks.push(withPhase(ctx, "sitemap", () => generateSitemap(ctx)));
  if (ctx.config.ogImage) tasks.push(withPhase(ctx, "og-images", () => generateOgImages(ctx)));

  // Static-asset output — gated on the presence of the public source dir.
  const hasPublicDir = existsSync(ctx.config.publicDir ?? DEFAULT_PUBLIC_DIR);
  if (hasPublicDir) tasks.push(withPhase(ctx, "public", () => copyPublic(ctx)));

  // Fallback outputs (404 page, locale redirects) — each gated on its config flag.
  if (ctx.config.notFound) tasks.push(withPhase(ctx, "not-found", () => generateNotFound(ctx)));
  if (ctx.config.localeRedirects)
    tasks.push(withPhase(ctx, "locale-redirects", () => generateLocaleRedirects(ctx)));

  // Run all enabled outputs concurrently, then surface any failures without aborting.
  const settled = await Promise.allSettled(tasks);
  reportOutputFailures(ctx, settled);
}

/**
 * Executes the full SSG pipeline for one run: clean → bundle → content/images →
 * pages → feeds/sitemap/og-images → cache-headers → root-index. Orchestrates `ctx.require` pulls
 * and `Promise.all` only — never inlines dependency domain logic. Emits a
 * `build:phase` boundary per phase and `build:complete` once at the end.
 *
 * @param ctx - Plugin context (provides `require`, `emit`, `state`, `config`, `log`).
 * @param options - Optional per-run overrides ({@link RunOptions}).
 * @returns The build result (outDir, pageCount, durationMs).
 * @example
 * ```ts
 * const result = await runPipeline(ctx, { outDir: "./dist" });
 * ```
 */
export async function runPipeline(ctx: PhaseContext, options?: RunOptions): Promise<BuildResult> {
  const started = Date.now();
  resetRun(ctx, options);
  const outDir = options?.outDir ?? ctx.config.outDir;

  // Merge any per-run config overrides (dev rebuilds disable feeds/sitemap/minify/etc.)
  // over the snapshot for this run only — the persisted plugin config is never mutated.
  const phaseContext: PhaseContext = {
    ...ctx,
    config: { ...ctx.config, outDir, ...options?.overrides }
  };

  // Plan what this run may safely reuse from the changed-path set (dev incremental).
  const plan = planIncrementalRebuild(options?.changed);

  // Phase 0 — clean (setup only, not a build:phase boundary). A dev rebuild passes
  // `skipClean` so the prior assets + on-disk caches survive (and so an in-flight dev
  // request never hits a momentarily-empty outDir); `mkdir` still ensures outDir exists.
  // The recursive force-delete only ever runs against an asserted-safe target — a
  // misconfigured outDir ("/", ".", home, a ".." escape) throws instead of deleting.
  if (!options?.skipClean) {
    assertSafeCleanTarget(outDir, process.cwd());
    await rm(outDir, { recursive: true, force: true });
  }
  await mkdir(outDir, { recursive: true });

  // Phase 1 — bundle.
  await withPhase(phaseContext, "bundle", () => bundle(phaseContext));

  // Phase 2 — content + images + content-images (parallel; content delegates to the content plugin,
  // content-images copies each article's co-located images next to its locale pages by convention).
  await Promise.all([
    withPhase(phaseContext, "content", () =>
      loadContent(phaseContext, { reuse: plan.contentReuse, changed: plan.contentChanged })
    ),
    withPhase(phaseContext, "images", () => processImages(phaseContext))
  ]);

  // Phase 3 — pages (reuse cached renders when only content/styles changed).
  const pages = await withPhase(phaseContext, "pages", () =>
    renderPages(phaseContext, { reuse: plan.renderReuse })
  );

  // Phase 3.5 — content-images. Runs after `pages` so the article tree is fully written before
  // co-located images are copied into the shared `<outDir>/<slug>/images/` dirs.
  await withPhase(phaseContext, "content-images", () => copyContentImages(phaseContext));

  // Phase 4 — feeds + sitemap + og-images (gated; allSettled).
  await runOutputs(phaseContext);

  // Phase 4.5 — cache headers (gated; default on). Runs strictly AFTER the outputs
  // group: the public phase copies `<publicDir>/_headers` into outDir verbatim, and
  // this phase overwrites it with the merged (generated + app) rule file.
  if (phaseContext.config.cacheHeaders !== false) {
    await withPhase(phaseContext, "cache-headers", () => generateCacheHeaders(phaseContext));
  }

  // Phase 5 — root-index (write the captured default-page HTML when present).
  await withPhase(phaseContext, "root-index", async () => {
    if (pages.rootHtml !== null) {
      await writeFile(path.join(outDir, "index.html"), pages.rootHtml, "utf8");
    }
  });

  const result: BuildResult = {
    outDir,
    pageCount: pages.pageCount,
    durationMs: Date.now() - started
  };
  phaseContext.emit("build:complete", result);
  return result;
}
