/**
 * @file build plugin — pipeline driver. Sequences the fixed multi-phase build,
 * emits `build:phase` boundaries, and runs intra-phase work via `Promise.all`.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { bundle } from "./phases/bundle";
import { loadContent } from "./phases/content";
import { generateFeeds } from "./phases/feeds";
import { processImages } from "./phases/images";
import { generateOgImages } from "./phases/og-images";
import { renderPages } from "./phases/pages";
import { generateSitemap } from "./phases/sitemap";
import type { BuildResult, PhaseContext, PhaseName } from "./types";

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
  "feeds",
  "sitemap",
  "og-images",
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
 *
 * @param ctx - The phase context whose `state` is reset.
 * @example
 * ```ts
 * resetRun(ctx);
 * ```
 */
function resetRun(ctx: Pick<PhaseContext, "state">): void {
  // eslint-disable-next-line unicorn/no-null -- `manifest` is `RouteDefinition[] | null` until the pages phase populates it
  ctx.state.manifest = null;
  ctx.state.buildCache = new Map<string, unknown>();
  ctx.state.runId = `${Date.now()}-${randomUUID()}`;
}

/**
 * Phase 4 — run feeds / sitemap / og-images concurrently, each gated by its config
 * flag, isolated with `Promise.allSettled` so one failure does not lose the others.
 * A disabled output is skipped entirely — it emits NO `build:phase` boundary (the
 * `withPhase` wrapper is gated on the config flag, not just the phase body).
 *
 * @param ctx - The phase context.
 * @example
 * ```ts
 * await runOutputs(ctx);
 * ```
 */
async function runOutputs(ctx: PhaseContext): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (ctx.config.feeds) tasks.push(withPhase(ctx, "feeds", () => generateFeeds(ctx)));
  if (ctx.config.sitemap) tasks.push(withPhase(ctx, "sitemap", () => generateSitemap(ctx)));
  if (ctx.config.ogImage) tasks.push(withPhase(ctx, "og-images", () => generateOgImages(ctx)));
  const settled = await Promise.allSettled(tasks);
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      ctx.log.error("build:outputs", { reason: String(outcome.reason) });
    }
  }
}

/**
 * Executes the full SSG pipeline for one run: clean → bundle → content/images →
 * pages → feeds/sitemap/og-images → root-index. Orchestrates `ctx.require` pulls
 * and `Promise.all` only — never inlines dependency domain logic. Emits a
 * `build:phase` boundary per phase and `build:complete` once at the end.
 *
 * @param ctx - Plugin context (provides `require`, `emit`, `state`, `config`, `log`).
 * @param options - Optional run overrides.
 * @param options.outDir - Override the configured output directory for this run.
 * @returns The build result (outDir, pageCount, durationMs).
 * @example
 * ```ts
 * const result = await runPipeline(ctx, { outDir: "./dist" });
 * ```
 */
export async function runPipeline(
  ctx: PhaseContext,
  options?: { outDir?: string }
): Promise<BuildResult> {
  const started = Date.now();
  resetRun(ctx);
  const outDir = options?.outDir ?? ctx.config.outDir;
  const phaseContext: PhaseContext = { ...ctx, config: { ...ctx.config, outDir } };

  // Phase 0 — clean (setup only, not a build:phase boundary).
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // Phase 1 — bundle.
  await withPhase(phaseContext, "bundle", () => bundle(phaseContext));

  // Phase 2 — content + images (parallel; content delegates to the content plugin).
  await Promise.all([
    withPhase(phaseContext, "content", () => loadContent(phaseContext)),
    withPhase(phaseContext, "images", () => processImages(phaseContext))
  ]);

  // Phase 3 — pages.
  const pages = await withPhase(phaseContext, "pages", () => renderPages(phaseContext));

  // Phase 4 — feeds + sitemap + og-images (gated; allSettled).
  await runOutputs(phaseContext);

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
