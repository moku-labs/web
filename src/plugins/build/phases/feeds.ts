/**
 * @file build phase 4 — feeds. Generates RSS/Atom/JSON from cached content plus
 * site/i18n metadata (per-item GUID = canonical article URL). Gated by config.feeds.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Feed } from "feed";
import type { Article } from "../../content/types";
import { i18nPlugin } from "../../i18n";
import { sitePlugin } from "../../site";
import type { PhaseContext } from "../types";
import { readCachedContent } from "./content";

/** Result of the feeds phase — the produced feed payloads (also written to disk). */
export type FeedsResult = {
  /** RSS 2.0 feed XML. */
  rss: string;
  /** Atom 1.0 feed XML. */
  atom: string;
  /** JSON Feed 1.x payload. */
  json: string;
  /** Canonical GUID set (one per feed item), in article order. */
  guids: string[];
};

/**
 * Select the published articles for the default locale from the cached content
 * map (feeds are single-locale by convention — the default-locale collection).
 *
 * @param byLocale - The cached locale-keyed article map.
 * @param defaultLocale - The default locale code from i18n.
 * @returns The published default-locale articles.
 * @example
 * ```ts
 * selectArticles(byLocale, "en");
 * ```
 */
function selectArticles(byLocale: Map<string, Article[]>, defaultLocale: string): Article[] {
  const articles = byLocale.get(defaultLocale) ?? [];
  return articles.filter(article => article.computed.status === "published");
}

/**
 * Generates RSS, Atom, and JSON feeds from the cached default-locale content set
 * and the `site`/`i18n` metadata pulled via `ctx.require`. Each item's GUID is its
 * canonical (absolute) article URL. Writes `feed.xml`, `atom.xml`, and `feed.json`
 * to `outDir`. No-op when `config.feeds` is false.
 *
 * @param ctx - Plugin context (provides `require`, `state`, `config`, `log`).
 * @returns The generated feed payloads + GUID set, or `null` when disabled.
 * @example
 * ```ts
 * const feeds = await generateFeeds(ctx);
 * ```
 */
export async function generateFeeds(
  ctx: Pick<PhaseContext, "require" | "state" | "config" | "log">
): Promise<FeedsResult | null> {
  if (!ctx.config.feeds) {
    ctx.log.debug("build:feeds", { skipped: true });
    // eslint-disable-next-line unicorn/no-null -- `null` signals a disabled phase (asserted via toBeNull)
    return null;
  }
  const site = ctx.require(sitePlugin);
  const i18n = ctx.require(i18nPlugin);
  const articles = selectArticles(readCachedContent(ctx), i18n.defaultLocale());
  const feed = new Feed({
    title: site.name(),
    description: site.description(),
    id: site.url(),
    link: site.url(),
    language: i18n.defaultLocale(),
    copyright: site.author(),
    author: { name: site.author() }
  });
  const guids: string[] = [];
  for (const article of articles) {
    const canonicalUrl = site.canonical(article.url);
    guids.push(canonicalUrl);
    feed.addItem({
      title: article.frontmatter.title,
      id: canonicalUrl,
      guid: canonicalUrl,
      link: canonicalUrl,
      description: article.frontmatter.description,
      content: article.html,
      date: new Date(article.frontmatter.date),
      author: [{ name: article.frontmatter.author ?? site.author() }]
    });
  }
  const result: FeedsResult = {
    rss: feed.rss2(),
    atom: feed.atom1(),
    json: feed.json1(),
    guids
  };
  await mkdir(ctx.config.outDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(ctx.config.outDir, "feed.xml"), result.rss, "utf8"),
    writeFile(path.join(ctx.config.outDir, "atom.xml"), result.atom, "utf8"),
    writeFile(path.join(ctx.config.outDir, "feed.json"), result.json, "utf8")
  ]);
  ctx.log.debug("build:feeds", { items: guids.length });
  return result;
}
