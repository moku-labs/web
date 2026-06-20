/**
 * @file build phase 4 — feeds. Generates RSS/Atom/JSON from cached content plus
 * site/i18n metadata (per-item GUID = canonical article URL). Gated by config.feeds.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Feed } from "feed";
import type { Article } from "../../content/types";
import { fallbackI18n, i18nPlugin } from "../../i18n";
import { sitePlugin } from "../../site";
import type { Api as SiteApi } from "../../site/types";
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
 * Build the feed channel — the site-wide metadata that every item hangs off.
 *
 * @param site - The site plugin API (name, description, url, author).
 * @param defaultLocale - The default locale code, used as the feed language.
 * @returns A `Feed` carrying the channel metadata, with no items yet.
 * @example
 * ```ts
 * const feed = createFeedChannel(site, "en");
 * ```
 */
function createFeedChannel(site: SiteApi, defaultLocale: string): Feed {
  return new Feed({
    title: site.name(),
    description: site.description(),
    id: site.url(),
    link: site.url(),
    language: defaultLocale,
    copyright: site.author(),
    author: { name: site.author() }
  });
}

/** Matches a root-relative `src`/`href` attribute opening (`="/`), excluding protocol-relative `="//`. */
const ROOT_RELATIVE_URL_ATTR = /\b(src|href)="\/(?!\/)/g;

/**
 * Absolutize root-relative `src`/`href` URLs in rendered article HTML against the
 * site base URL. The content pipeline rewrites co-located images to root-relative
 * paths (`/<slug>/images/...`) — fine on the site, broken inside a feed, where
 * readers do not reliably resolve relative URLs. Protocol-relative (`//host/...`)
 * and already-absolute URLs are left untouched.
 *
 * @param html - The rendered article HTML.
 * @param baseUrl - The absolute site base URL (trailing slashes tolerated).
 * @returns The HTML with every root-relative URL made absolute.
 * @example
 * ```ts
 * absolutizeContentUrls('<img src="/post/images/a.webp">', "https://blog.dev");
 * // '<img src="https://blog.dev/post/images/a.webp">'
 * ```
 */
function absolutizeContentUrls(html: string, baseUrl: string): string {
  let base = baseUrl;
  while (base.endsWith("/")) base = base.slice(0, -1);
  return html.replaceAll(
    ROOT_RELATIVE_URL_ATTR,
    (_match, attribute: string) => `${attribute}="${base}/`
  );
}

/**
 * Append one article to the feed and return its canonical GUID. The canonical
 * URL is the article's single stable identity — it is the item's id, guid, and
 * link at once. Item content is the rendered HTML with root-relative URLs
 * absolutized against the site base, so embedded assets resolve in feed readers.
 *
 * @param feed - The feed channel to append to (mutated in place).
 * @param article - The published article to add.
 * @param site - The site plugin API (canonical URL + default author).
 * @returns The article's canonical (absolute) URL, used as its GUID.
 * @example
 * ```ts
 * const guid = addArticleItem(feed, article, site);
 * ```
 */
function addArticleItem(feed: Feed, article: Article, site: SiteApi): string {
  const canonicalUrl = site.canonical(article.url);
  feed.addItem({
    title: article.frontmatter.title,
    id: canonicalUrl,
    guid: canonicalUrl,
    link: canonicalUrl,
    description: article.frontmatter.description,
    content: absolutizeContentUrls(article.html, site.url()),
    date: new Date(article.frontmatter.date),
    author: [{ name: article.frontmatter.author ?? site.author() }]
  });
  return canonicalUrl;
}

/**
 * Write the three serialized feeds into `outDir`, creating it if needed.
 *
 * @param outDir - The build output directory.
 * @param result - The serialized feed payloads to persist.
 * @returns Resolves once `feed.xml`, `atom.xml`, and `feed.json` are written.
 * @example
 * ```ts
 * await writeFeedFiles(ctx.config.outDir, result);
 * ```
 */
async function writeFeedFiles(outDir: string, result: FeedsResult): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outDir, "feed.xml"), result.rss, "utf8"),
    writeFile(path.join(outDir, "atom.xml"), result.atom, "utf8"),
    writeFile(path.join(outDir, "feed.json"), result.json, "utf8")
  ]);
}

/**
 * Generates RSS, Atom, and JSON feeds from the cached default-locale content set
 * and the `site`/`i18n` metadata pulled via `ctx.require`. Each item's GUID is its
 * canonical (absolute) article URL. Writes `feed.xml`, `atom.xml`, and `feed.json`
 * to `outDir`. No-op when `config.feeds` is false.
 *
 * @param ctx - Plugin context (provides `require`, `has`, `state`, `config`, `log`).
 * @returns The generated feed payloads + GUID set, or `null` when disabled.
 * @example
 * ```ts
 * const feeds = await generateFeeds(ctx);
 * ```
 */
export async function generateFeeds(
  ctx: Pick<PhaseContext, "require" | "has" | "state" | "config" | "log">
): Promise<FeedsResult | null> {
  // Feeds are opt-in — a disabled build skips the phase entirely.
  if (!ctx.config.feeds) {
    ctx.log.debug("build:feeds", { skipped: true });
    // eslint-disable-next-line unicorn/no-null -- `null` signals a disabled phase (asserted via toBeNull)
    return null;
  }

  // Gather the inputs: site/i18n metadata and the published default-locale articles.
  // i18n is OPTIONAL — single default-locale fallback when not composed.
  const site = ctx.require(sitePlugin);
  const i18n = ctx.has("i18n") ? ctx.require(i18nPlugin) : fallbackI18n;
  const defaultLocale = i18n.defaultLocale();
  const articles = selectArticles(readCachedContent(ctx), defaultLocale);

  // Build the channel, then add one item per article, collecting GUIDs in order.
  const feed = createFeedChannel(site, defaultLocale);
  const guids: string[] = [];
  for (const article of articles) {
    guids.push(addArticleItem(feed, article, site));
  }

  // Serialize the channel to all three formats and persist them to outDir.
  const result: FeedsResult = { rss: feed.rss2(), atom: feed.atom1(), json: feed.json1(), guids };
  await writeFeedFiles(ctx.config.outDir, result);

  ctx.log.debug("build:feeds", { items: guids.length });
  return result;
}
