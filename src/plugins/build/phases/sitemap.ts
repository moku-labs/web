/**
 * @file build phase 4 — sitemap. Generates a sitemap + robots.txt from the route
 * manifest and `site.url`. Gated by config.sitemap.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { i18nPlugin } from "../../i18n";
import { routerPlugin } from "../../router";
import type { RouteDefinition, TypedRoute } from "../../router/types";
import { sitePlugin } from "../../site";
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
 * @returns The relative URLs produced by this route.
 * @example
 * ```ts
 * await expandUrls(def, entry, ["en"]);
 * ```
 */
async function expandUrls(
  definition: RouteDefinition,
  entry: TypedRoute,
  locales: readonly string[]
): Promise<string[]> {
  const urls: string[] = [];
  for (const locale of locales) {
    const generated = definition._handlers.generate
      ? await definition._handlers.generate(locale)
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
  ctx: Pick<PhaseContext, "require" | "config" | "log">
): Promise<SitemapResult | null> {
  if (!ctx.config.sitemap) {
    ctx.log.debug("build:sitemap", { skipped: true });
    // eslint-disable-next-line unicorn/no-null -- `null` signals a disabled phase (asserted via toBeNull)
    return null;
  }
  const site = ctx.require(sitePlugin);
  const locales = ctx.require(i18nPlugin).locales();
  const router = ctx.require(routerPlugin);
  const manifest = router.manifest();
  const byPattern = new Map<string, TypedRoute>();
  for (const entry of router.entries()) byPattern.set(entry.pattern, entry);
  const relativeLists = await Promise.all(
    manifest.map(definition => {
      const entry = byPattern.get(definition.pattern);
      if (!entry) {
        throw new Error(
          `[web] build.sitemap: no router entry for pattern "${definition.pattern}" — ` +
            "router.manifest() and router.entries() are out of sync."
        );
      }
      return expandUrls(definition, entry, locales);
    })
  );
  const urls = relativeLists.flat().map(relative => site.canonical(relative));
  const xml = serializeSitemap(urls);
  const robots = `User-agent: *\nAllow: /\nSitemap: ${site.canonical("/sitemap.xml")}\n`;
  await mkdir(ctx.config.outDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(ctx.config.outDir, "sitemap.xml"), xml, "utf8"),
    writeFile(path.join(ctx.config.outDir, "robots.txt"), robots, "utf8")
  ]);
  ctx.log.debug("build:sitemap", { urls: urls.length });
  return { urls, xml, robots };
}
