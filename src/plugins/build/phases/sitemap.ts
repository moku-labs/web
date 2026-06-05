/**
 * @file build phase 4 — sitemap. Generates a sitemap + robots.txt from the route
 * manifest and `site.url`. Gated by config.sitemap.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { i18nPlugin } from "../../i18n";
import { routerPlugin } from "../../router";
import type {
  GenerateContext,
  RouteDefinition,
  Api as RouterApi,
  TypedRoute
} from "../../router/types";
import { sitePlugin } from "../../site";
import type { Api as SiteApi } from "../../site/types";
import type { PhaseContext } from "../types";

/** Result of the sitemap phase — the canonical URL set + serialized documents. */
export type SitemapResult = {
  /** The canonical (absolute) URL set, in manifest order. */
  urls: string[];
  /** The serialized `sitemap.xml`. */
  xml: string;
  /** The serialized `robots.txt`. */
  robots: string;
};

/**
 * Expand one route definition into its instance URLs across all locales, mirroring
 * the pages phase (`generate?.(locale)` or a single empty-params instance). URLs are
 * derived via the router's compiled `TypedRoute.toUrl` (single source of truth) —
 * `build` does not re-substitute the raw pattern.
 *
 * @param definition - The route definition from the manifest.
 * @param entry - The compiled `TypedRoute` correlated by pattern (owns `toUrl`).
 * @param locales - Active locale codes from i18n.
 * @param ctx - Phase context slice (`require`/`has`) forwarded into the `generate()` ctx.
 * @returns The relative URLs produced by this route.
 * @example
 * ```ts
 * await expandUrls(def, entry, ["en"], ctx);
 * ```
 */
async function expandUrls(
  definition: RouteDefinition,
  entry: TypedRoute,
  locales: readonly string[],
  ctx: Pick<PhaseContext, "require" | "has">
): Promise<string[]> {
  const urls: string[] = [];
  for (const locale of locales) {
    const generateContext: GenerateContext = { locale, require: ctx.require, has: ctx.has };
    const generated = definition._handlers.generate
      ? await definition._handlers.generate(generateContext)
      : [{}];
    for (const raw of generated) {
      urls.push(entry.toUrl((raw ?? {}) as Record<string, string>));
    }
  }
  return urls;
}

/**
 * Serialize a `<urlset>` sitemap document from a canonical URL set.
 *
 * @param urls - The canonical (absolute) URLs.
 * @returns The serialized sitemap XML.
 * @example
 * ```ts
 * serializeSitemap(["https://blog.dev/en/hello/"]);
 * ```
 */
function serializeSitemap(urls: readonly string[]): string {
  const entries = urls.map(url => `  <url><loc>${url}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

/**
 * Index the compiled router entries by their URL pattern, so each manifest
 * definition can be correlated with the `TypedRoute` that owns `toUrl`.
 *
 * @param router - The router plugin API.
 * @returns A map from pattern string to its compiled `TypedRoute`.
 * @example
 * ```ts
 * const byPattern = indexRoutesByPattern(router);
 * ```
 */
function indexRoutesByPattern(router: RouterApi): Map<string, TypedRoute> {
  const byPattern = new Map<string, TypedRoute>();
  for (const entry of router.entries()) {
    byPattern.set(entry.pattern, entry);
  }
  return byPattern;
}

/**
 * Resolve the compiled entry for a manifest definition, asserting the router
 * invariant that `manifest()` and `entries()` stay in sync.
 *
 * @param byPattern - The pattern→entry index from {@link indexRoutesByPattern}.
 * @param definition - The route definition from the manifest.
 * @returns The compiled `TypedRoute` for the definition's pattern.
 * @throws {Error} When no compiled entry exists for the definition's pattern.
 * @example
 * ```ts
 * const entry = resolveRouteEntry(byPattern, definition);
 * ```
 */
function resolveRouteEntry(
  byPattern: Map<string, TypedRoute>,
  definition: RouteDefinition
): TypedRoute {
  const entry = byPattern.get(definition.pattern);
  if (entry === undefined) {
    throw new Error(
      `[web] build.sitemap: no router entry for pattern "${definition.pattern}" — ` +
        "router.manifest() and router.entries() are out of sync."
    );
  }
  return entry;
}

/**
 * Expand every manifest route to the relative URLs it produces across all
 * locales, correlating each definition with its compiled entry.
 *
 * @param manifest - The route definitions from `router.manifest()`.
 * @param byPattern - The pattern→entry index from {@link indexRoutesByPattern}.
 * @param locales - Active locale codes from i18n.
 * @param ctx - Phase context slice forwarded into each `generate()` call.
 * @returns The flattened relative URL list, in manifest order.
 * @example
 * ```ts
 * const relative = await collectRelativeUrls(router.manifest(), byPattern, locales, ctx);
 * ```
 */
async function collectRelativeUrls(
  manifest: readonly RouteDefinition[],
  byPattern: Map<string, TypedRoute>,
  locales: readonly string[],
  ctx: Pick<PhaseContext, "require" | "has">
): Promise<string[]> {
  const lists = await Promise.all(
    manifest.map(definition => {
      const entry = resolveRouteEntry(byPattern, definition);
      return expandUrls(definition, entry, locales, ctx);
    })
  );
  return lists.flat();
}

/**
 * Serialize a permissive `robots.txt` that allows all crawlers and advertises
 * the sitemap location.
 *
 * @param site - The site plugin API (for the canonical sitemap URL).
 * @returns The serialized `robots.txt` document.
 * @example
 * ```ts
 * buildRobotsTxt(site);
 * ```
 */
function buildRobotsTxt(site: SiteApi): string {
  return `User-agent: *\nAllow: /\nSitemap: ${site.canonical("/sitemap.xml")}\n`;
}

/**
 * Write `sitemap.xml` and `robots.txt` into `outDir`, creating it if needed.
 *
 * @param outDir - The build output directory.
 * @param xml - The serialized sitemap document.
 * @param robots - The serialized robots document.
 * @returns Resolves once both files are written.
 * @example
 * ```ts
 * await writeSitemapFiles(ctx.config.outDir, xml, robots);
 * ```
 */
async function writeSitemapFiles(outDir: string, xml: string, robots: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outDir, "sitemap.xml"), xml, "utf8"),
    writeFile(path.join(outDir, "robots.txt"), robots, "utf8")
  ]);
}

/**
 * Generates `sitemap.xml` (canonical URL set derived from the route manifest +
 * `site.url`) and `robots.txt` (pointing at the sitemap). No-op when
 * `config.sitemap` is false.
 *
 * @param ctx - Plugin context (provides `require`, `config`, `log`).
 * @returns The canonical URL set + serialized documents, or `null` when disabled.
 * @example
 * ```ts
 * const sitemap = await generateSitemap(ctx);
 * ```
 */
export async function generateSitemap(
  ctx: Pick<PhaseContext, "require" | "config" | "log" | "has">
): Promise<SitemapResult | null> {
  // Sitemap is opt-in — a disabled build skips the phase entirely.
  if (!ctx.config.sitemap) {
    ctx.log.debug("build:sitemap", { skipped: true });
    // eslint-disable-next-line unicorn/no-null -- `null` signals a disabled phase (asserted via toBeNull)
    return null;
  }

  // Gather the inputs: site metadata, active locales, and the route manifest.
  const site = ctx.require(sitePlugin);
  const locales = ctx.require(i18nPlugin).locales();
  const router = ctx.require(routerPlugin);

  // Expand every route to its canonical (absolute) URLs across all locales.
  const byPattern = indexRoutesByPattern(router);
  const relativeUrls = await collectRelativeUrls(router.manifest(), byPattern, locales, ctx);
  const urls = relativeUrls.map(relative => site.canonical(relative));

  // Serialize the sitemap + robots documents and persist them to outDir.
  const xml = serializeSitemap(urls);
  const robots = buildRobotsTxt(site);
  await writeSitemapFiles(ctx.config.outDir, xml, robots);

  ctx.log.debug("build:sitemap", { urls: urls.length });
  return { urls, xml, robots };
}
