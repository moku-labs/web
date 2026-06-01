/**
 * @file data plugin — Node write side of the isomorphic bridge (`emit()`).
 *
 * This is the ONLY module in the `data` plugin that touches `node:*`. It is
 * reached exclusively through a lazy `await import("./emit")` inside `api.ts`'s
 * `emit()`, so a browser bundle that composes `data` for the read side never
 * statically pulls `node:fs`/`node:crypto` (see `__tests__/unit/isolation.test.ts`).
 *
 * ## What emit() produces (the build↔runtime contract)
 * `<outDir>/<config.outputDir>/`
 *   - `routes-manifest.json` — STABLE, un-hashed filename (short cache) the client
 *     discovers without a hash: `{ buildId, routes: [{ pattern, name, meta, dataUrl }] }`.
 *   - `<slug>.<hash>.json` — one content-hashed sidecar per CONCRETE page (long
 *     cache), referenced by the resolved `dataUrl` in the manifest.
 *
 * ## Why expansion mirrors `build` (a documented refinement of spec 07 §"W3")
 * The sidecars must live at the SAME concrete URLs/files the `build` pages phase
 * wrote, for arbitrary routes (custom `toUrl`/`toFile`, locale prefixes). The
 * serializable `router.clientManifest()` projection (spec/03 §1) carries only
 * `{ pattern, name, meta }` and CANNOT reproduce those concrete instances. So emit
 * expands via `router.manifest()` + `router.entries()` — the typed
 * build-consumption mechanism (spec/03 §1) — exactly as `build/phases/pages.tsx`
 * does. `content.loadAll()` (production-FILTERED; never `load()` — draft safety)
 * supplies the active locale set (its keys). One sidecar entry per concrete page,
 * its `pattern` field holding the RESOLVED URL so the wave-4 `iso-match` matcher
 * resolves it exactly (and custom `toFile` URLs never 404).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { contentPlugin } from "../content";
import { routerPlugin } from "../router";
import type { RouteContext, RouteDefinition, RouteState, TypedRoute } from "../router/types";
import type { DataPluginContext } from "./api";
import type { EmitSummary, RouteIndexFile, SidecarData, SidecarFragment } from "./types";

/** Default build output root, matching `build`'s `defaultBuildConfig.outDir`. */
const DEFAULT_OUT_DIR = "./dist";
/** Concurrency bound for sidecar writes (matches the OG-image phase's pool). */
const WRITE_CONCURRENCY = 8;
/** Length of the hex content-hash slice used in sidecar filenames + the buildId. */
const HASH_LENGTH = 16;
/** STABLE, un-hashed manifest filename the client discovers without a hash. */
const MANIFEST_NAME = "routes-manifest.json";

/** One concrete page instance — a route expanded for one param set + locale. */
type ConcretePage = {
  /** Resolved URL (`entry.toUrl(params)`) — the manifest entry's `pattern`. */
  readonly url: string;
  /** Resolved on-disk file (`entry.toFile(params)`) the build wrote the HTML to. */
  readonly file: string;
  /** Route name key. */
  readonly name: string;
  /** Serializable route metadata bag. */
  readonly meta: Record<string, unknown>;
  /** The owning route definition (carries `_handlers` for the data payload). */
  readonly definition: RouteDefinition;
  /** Resolved params for this instance. */
  readonly params: Record<string, string>;
  /** Active locale for this instance. */
  readonly locale: string;
};

/**
 * Compute a stable hex content hash (sliced) of a UTF-8 string.
 *
 * @param body - The serialized content to hash.
 * @returns The first {@link HASH_LENGTH} hex chars of the SHA-256 digest.
 * @example
 * ```ts
 * contentHash('{"a":1}'); // "9bf2…"
 * ```
 */
function contentHash(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, HASH_LENGTH);
}

/**
 * Derive a filesystem-safe sidecar base name from a resolved URL: trim slashes and
 * replace path separators / unsafe chars with `_`; the root URL becomes `index`.
 *
 * @param url - The resolved route URL (e.g. `/blog/hello/`).
 * @returns A safe base name (e.g. `blog_hello`), or `index` for the root.
 * @example
 * ```ts
 * urlToBaseName("/blog/hello/"); // "blog_hello"
 * ```
 */
function urlToBaseName(url: string): string {
  let trimmed = url;
  while (trimmed.startsWith("/")) trimmed = trimmed.slice(1);
  while (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
  return trimmed.length > 0 ? trimmed.replaceAll(/[^\w.-]+/g, "_") : "index";
}

/**
 * Extract the inner `<body>` HTML from a full SSR document, falling back to the
 * whole string when no `<body>` is present (so a custom template still yields a
 * usable fragment). Reuses the build's already-rendered HTML — never re-renders.
 *
 * @param html - The full HTML document read from the build output.
 * @returns The inner-body fragment for the swap region.
 * @example
 * ```ts
 * extractBody("<html><body><h1>Hi</h1></body></html>"); // "<h1>Hi</h1>"
 * ```
 */
function extractBody(html: string): string {
  const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return match?.[1] ?? html;
}

/**
 * Expand one correlated route definition into its concrete page instances across
 * the active locales via `generate?.(locale)` (a single empty-params instance when
 * absent) — mirroring `build/phases/pages.tsx`. `toUrl`/`toFile` own URL/file
 * derivation so emit never re-derives paths from the raw pattern.
 *
 * @param definition - The typed route definition from `router.manifest()`.
 * @param entry - The compiled `TypedRoute` correlated by `pattern`.
 * @param locales - The active locale codes (from `content.loadAll()` keys).
 * @returns The concrete pages for this route across all locales.
 * @example
 * ```ts
 * await expandDefinition(definition, entry, ["en"]);
 * ```
 */
async function expandDefinition(
  definition: RouteDefinition,
  entry: TypedRoute,
  locales: readonly string[]
): Promise<ConcretePage[]> {
  const pages: ConcretePage[] = [];
  for (const locale of locales) {
    const generated = definition._handlers.generate
      ? await definition._handlers.generate(locale)
      : [{}];
    for (const raw of generated) {
      const params = (raw ?? {}) as Record<string, string>;
      pages.push({
        url: entry.toUrl(params),
        file: entry.toFile(params),
        name: entry.name,
        meta: entry.meta,
        definition,
        params,
        locale
      });
    }
  }
  return pages;
}

/**
 * Correlate each `manifest()` route definition to its compiled `TypedRoute` from
 * `entries()` by `pattern`, expand each via {@link expandDefinition}, and flatten —
 * deduplicating by resolved URL (locale-agnostic static routes collapse to one).
 *
 * @param definitions - The typed route definitions from `router.manifest()`.
 * @param entries - The compiled `TypedRoute`s from `router.entries()`.
 * @param locales - The active locale codes (from `content.loadAll()` keys).
 * @returns The flattened, URL-deduplicated list of concrete pages.
 * @example
 * ```ts
 * const pages = await expandPages(router.manifest(), router.entries(), ["en"]);
 * ```
 */
async function expandPages(
  definitions: readonly RouteDefinition[],
  entries: readonly TypedRoute[],
  locales: readonly string[]
): Promise<ConcretePage[]> {
  const byPattern = new Map<string, TypedRoute>();
  for (const entry of entries) byPattern.set(entry.pattern, entry);
  const correlated = definitions
    .map(definition => ({ definition, entry: byPattern.get(definition.pattern) }))
    .filter((pair): pair is { definition: RouteDefinition; entry: TypedRoute } =>
      Boolean(pair.entry)
    );
  const expanded = await Promise.all(
    correlated.map(({ definition, entry }) => expandDefinition(definition, entry, locales))
  );
  const seen = new Set<string>();
  return expanded.flat().filter(page => !seen.has(page.url) && Boolean(seen.add(page.url)));
}

/**
 * Build a `"fragment"` sidecar by reusing the page's already-rendered SSR HTML
 * from the build output (no re-render). Returns `null` when the file is absent
 * (the page was not built) so the caller skips it.
 *
 * @param page - The concrete page instance.
 * @param outDir - The build output root the HTML was written under.
 * @returns The fragment sidecar, or `null` when the source HTML is missing.
 * @example
 * ```ts
 * await fragmentSidecar(page, "./dist");
 * ```
 */
async function fragmentSidecar(
  page: ConcretePage,
  outDir: string
): Promise<SidecarFragment | null> {
  const filePath = path.join(outDir, page.file);
  if (!existsSync(filePath)) {
    // eslint-disable-next-line unicorn/no-null -- explicit "no source HTML" signal
    return null;
  }
  return { html: extractBody(await readFile(filePath, "utf8")), meta: page.meta };
}

/**
 * Build a `"data"` sidecar from the route's own serializer: prefer `toJson(ctx)`
 * (the explicit projection), else the raw `load()` result. The route loader is the
 * consumer's code — emit never invokes content's per-slug loader directly, only the
 * production-filtered `loadAll()` (draft safety; see the file-level note + lint gate).
 *
 * @param page - The concrete page instance.
 * @returns The data sidecar for pure-SPA consumption.
 * @example
 * ```ts
 * await dataSidecar(page);
 * ```
 */
async function dataSidecar(page: ConcretePage): Promise<SidecarData> {
  const { definition, params, locale, meta } = page;
  const loaded = definition._handlers.load
    ? await definition._handlers.load(params, locale)
    : undefined;
  const routeContext: RouteContext<RouteState> = { params, data: loaded, locale };
  const data = definition._handlers.toJson ? definition._handlers.toJson(routeContext) : loaded;
  // eslint-disable-next-line unicorn/no-null -- JSON-stable "no data" value
  return { data: data ?? null, meta };
}

/**
 * Serialize, content-hash, and write one page's sidecar, returning its manifest
 * entry (`{ pattern, name, meta, dataUrl }`) — or `null` when a fragment page had
 * no source HTML and was skipped.
 *
 * @param page - The concrete page instance.
 * @param outDir - The build output root (read for `"fragment"` source HTML).
 * @param dataDir - The resolved `<outDir>/<outputDir>` write directory.
 * @param config - The resolved data config (`payload` + `baseUrl`).
 * @returns The manifest route entry, or `null` if the page was skipped.
 * @example
 * ```ts
 * await writeSidecar(page, "./dist", "./dist/_data", ctx.config);
 * ```
 */
async function writeSidecar(
  page: ConcretePage,
  outDir: string,
  dataDir: string,
  config: DataPluginContext["config"]
): Promise<RouteIndexFile["routes"][number] | null> {
  const sidecar =
    config.payload === "fragment" ? await fragmentSidecar(page, outDir) : await dataSidecar(page);
  if (sidecar === null) {
    // eslint-disable-next-line unicorn/no-null -- propagate the skip signal
    return null;
  }
  const body = JSON.stringify(sidecar);
  const fileName = `${urlToBaseName(page.url)}.${contentHash(body)}.json`;
  await writeFile(path.join(dataDir, fileName), body, "utf8");
  return {
    pattern: page.url,
    name: page.name,
    meta: page.meta,
    dataUrl: `${config.baseUrl}${fileName}`
  };
}

/**
 * The Node write side of the bridge. Resolves `router`/`content` lazily via
 * `ctx.require`, expands every route to its concrete pages (mirroring `build`),
 * writes one content-hashed sidecar per page (bounded by `p-limit`), then the
 * STABLE route-index manifest. Records the summary in `ctx.state.lastEmit`.
 *
 * `fragmentSidecar` reads `<outDir>` (the build output) for HTML, so `outDir` must
 * be the same directory `build.run()` wrote to — the call-site contract is
 * `await app.build.run(); await app.data.emit({ outDir });`.
 *
 * @param ctx - The data plugin context (state, config, require).
 * @param options - Optional overrides.
 * @param options.outDir - Build output directory to read from / write under (default `./dist`).
 * @returns A summary of the manifest path, sidecar count, and resolved outDir.
 * @example
 * ```ts
 * const summary = await emitData(ctx, { outDir: "./dist" });
 * ```
 */
export async function emitData(
  ctx: DataPluginContext,
  options?: { outDir?: string }
): Promise<EmitSummary> {
  const router = ctx.require(routerPlugin);
  const content = ctx.require(contentPlugin);
  const outDir = options?.outDir ?? DEFAULT_OUT_DIR;
  const dataDir = path.join(outDir, ctx.config.outputDir);

  const byLocale = await content.loadAll(); // production-filtered; keys = active locales
  const locales = byLocale.size > 0 ? [...byLocale.keys()] : [""];
  const pages = await expandPages(router.manifest(), router.entries(), locales);

  await mkdir(dataDir, { recursive: true });
  const limit = pLimit(WRITE_CONCURRENCY);
  const settled = await Promise.all(
    pages.map(page => limit(() => writeSidecar(page, outDir, dataDir, ctx.config)))
  );
  const routes = settled.filter(
    (entry): entry is RouteIndexFile["routes"][number] => entry !== null
  );

  const buildId = contentHash(routes.map(route => route.dataUrl).join("|"));
  const manifestPath = path.join(dataDir, MANIFEST_NAME);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify({ buildId, routes } satisfies RouteIndexFile),
    "utf8"
  );

  const summary: EmitSummary = { manifestPath, sidecarCount: routes.length, outDir };
  ctx.state.lastEmit = summary;
  return summary;
}
