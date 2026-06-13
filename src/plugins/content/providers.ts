/**
 * @file content plugin — built-in node provider: `fileSystemContent`.
 *
 * The NODE content source: discovers slug directories, reads + renders `{locale}.md`
 * files through the Markdown pipeline (gray-matter, unified, Shiki), and rewrites
 * co-located image URLs. Owns the lazy unified processor + discovery caches in a
 * private closure. This is the ONLY content module that imports `node:fs` / the
 * pipeline — so the content plugin shell (and `contentPlugin`) stays browser-safe.
 * Re-exported from the package ROOT only (never `/browser`), mirroring the node env
 * providers (`dotenv`/`processEnv`).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "./pipeline/frontmatter";
import { ensureProcessor } from "./pipeline/markdown";
import { calculateReadingTime } from "./pipeline/reading-time";
import type {
  Article,
  ContentProvider,
  ContentProviderState,
  FileSystemContentOptions
} from "./types";
import { validateFileSystemContentOptions } from "./validate";

/** Matches an `<img>` `src` that points at the co-located `images/` dir (relative or root-relative). */
const RELATIVE_IMAGE_SRC = /(<img\b[^>]*?\bsrc=")(?:\.?\/)?images\//g;

/** Matches the `data-embed-src` of an `::embed` facade (value captured for path resolution). */
const EMBED_SRC_ATTR = /(\bdata-embed-src=")([^"]*)(")/g;

/**
 * Build a canonical article URL for a locale + slug.
 *
 * @param locale - Requested locale code.
 * @param slug - Article directory name.
 * @returns The canonical article URL.
 * @example
 * ```ts
 * articleToUrl("en", "hello"); // "/en/hello/"
 * ```
 */
function articleToUrl(locale: string, slug: string): string {
  return `/${locale}/${slug}/`;
}

/**
 * Rewrite relative co-located image URLs (`./images/x.webp`) in rendered article HTML to the shared
 * absolute path the build copies them to (`/<slug>/images/...`), so they resolve from any locale page.
 *
 * @param html - The rendered article HTML.
 * @param slug - Article directory name.
 * @returns The HTML with image `src`s rewritten to absolute paths.
 * @example
 * ```ts
 * rewriteImageUrls('<img src="./images/a.webp">', "post"); // '<img src="/post/images/a.webp">'
 * ```
 */
function rewriteImageUrls(html: string, slug: string): string {
  return html.replaceAll(RELATIVE_IMAGE_SRC, `$1/${slug}/images/`);
}

/**
 * Resolve an `::embed` `src` to the URL the iframe should load. Absolute targets
 * (`http(s)://…`, root-relative `/…`) pass through unchanged; a co-located
 * relative path (`./game/index.html`, `../x`, `game/x`) is resolved against the
 * article base `/<slug>/` into the single shared absolute path the content-assets
 * build phase copies the bundle to — so it loads identically from every locale
 * page (mirroring how co-located images resolve). Any `?query`/`#hash` is
 * preserved verbatim.
 *
 * @param value - The raw `data-embed-src` value.
 * @param slug - Article directory name.
 * @returns The resolved embed URL.
 * @example
 * ```ts
 * resolveEmbedSource("./game/index.html", "post"); // "/post/game/index.html"
 * resolveEmbedSource("https://x.dev/", "post"); // "https://x.dev/"
 * ```
 */
export function resolveEmbedSource(value: string, slug: string): string {
  if (/^https?:\/\//i.test(value) || value.startsWith("/")) return value;

  // Split the path from any ?query/#hash so the tail survives resolution verbatim.
  const tailIndex = value.search(/[?#]/);
  const rawPath = tailIndex === -1 ? value : value.slice(0, tailIndex);
  const tail = tailIndex === -1 ? "" : value.slice(tailIndex);

  // Resolve `.`/`..` segments of the relative path against `/<slug>/`.
  const out: string[] = [];
  for (const segment of `${slug}/${rawPath}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  const trailingSlash = rawPath === "" || rawPath.endsWith("/") ? "/" : "";
  return `/${out.join("/")}${trailingSlash}${tail}`;
}

/**
 * Rewrite every `::embed` facade's relative `data-embed-src` to its shared
 * absolute `/<slug>/…` path (no-op for already-absolute targets).
 *
 * @param html - The rendered article HTML.
 * @param slug - Article directory name.
 * @returns The HTML with embed `src`s resolved.
 * @example
 * ```ts
 * rewriteEmbedUrls('<figure data-embed-src="./g/">', "post"); // '… data-embed-src="/post/g/"'
 * ```
 */
function rewriteEmbedUrls(html: string, slug: string): string {
  return html.replaceAll(
    EMBED_SRC_ATTR,
    (_match, prefix: string, value: string, suffix: string) =>
      `${prefix}${resolveEmbedSource(value, slug)}${suffix}`
  );
}

/**
 * Discover slug-like subdirectories of the content root (direct children not
 * starting with `.` or `_`), sorted alphabetically for deterministic ordering.
 *
 * @param dir - Content root directory.
 * @returns The sorted slug list.
 * @example
 * ```ts
 * const slugs = await discoverSlugs("./content"); // ["about", "intro"]
 * ```
 */
async function discoverSlugs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const slugs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    slugs.push(entry.name);
  }
  return slugs.toSorted();
}

/**
 * The node filesystem content provider: reads + renders Markdown from `contentDir`
 * through the full pipeline. Caches discovery + the unified processor internally.
 *
 * @param options - Filesystem + pipeline options (`contentDir`, `shikiTheme`, `trustedContent`, …).
 * @returns A {@link ContentProvider} backed by the local filesystem.
 * @example
 * ```ts
 * createApp({ pluginConfigs: { content: { providers: [fileSystemContent({ contentDir: "./content" })] } } });
 * ```
 */
export function fileSystemContent(options: FileSystemContentOptions): ContentProvider {
  // Fail fast on impossible option combinations (e.g. mermaid without trustedContent).
  validateFileSystemContentOptions(options);

  const state: ContentProviderState = {
    // eslint-disable-next-line unicorn/no-null -- `processor` is `Processor | null` until first build
    processor: null,
    // eslint-disable-next-line unicorn/no-null -- `slugs` is `string[] | null` until the first disk scan
    slugs: null,
    dirtyPaths: new Set()
  };

  return {
    name: `filesystem:${options.contentDir}`,
    contentDir: options.contentDir,
    /**
     * Discover slugs (cached after first scan).
     *
     * @returns The sorted slug list.
     * @example
     * ```ts
     * await provider.slugs();
     * ```
     */
    async slugs(): Promise<readonly string[]> {
      state.slugs ??= await discoverSlugs(options.contentDir);
      return state.slugs;
    },
    /**
     * Read + render one article file for a file-locale; `null` when the file is absent.
     *
     * @param slug - Article directory name.
     * @param fileLocale - Locale whose `{locale}.md` file is read.
     * @param outLocale - Locale the resulting Article represents.
     * @param isFallback - Whether this resolution used the default-locale fallback.
     * @returns The constructed Article, or `null` when absent.
     * @example
     * ```ts
     * await provider.readArticle("intro", "en", "en", false);
     * ```
     */
    async readArticle(
      slug: string,
      fileLocale: string,
      outLocale: string,
      isFallback: boolean
    ): Promise<Article | null> {
      const filePath = path.join(options.contentDir, slug, `${fileLocale}.md`);
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch {
        // eslint-disable-next-line unicorn/no-null -- absence is a `null` miss (return type is `Article | null`)
        return null;
      }
      state.dirtyPaths.delete(filePath);

      // Parse frontmatter and render the Markdown body through the pipeline.
      const { frontmatter, body } = parseFrontmatter(raw, options);
      const processor = ensureProcessor(state, options);
      const rendered = String(await processor.process(body));
      const html = rewriteEmbedUrls(rewriteImageUrls(rendered, slug), slug);

      // Derive computed metadata and assemble the Article.
      const { readingTime, wordCount } = calculateReadingTime(body);
      const status: "published" | "draft" = frontmatter.draft ? "draft" : "published";
      return {
        frontmatter,
        computed: { slug, readingTime, contentId: slug, status, wordCount },
        html,
        locale: outLocale,
        isFallback,
        url: articleToUrl(outLocale, slug)
      };
    },
    /**
     * Render a standalone Markdown string to HTML through the pipeline.
     *
     * @param markdown - Raw Markdown source.
     * @returns The rendered HTML string.
     * @example
     * ```ts
     * await provider.render("# Hi");
     * ```
     */
    async render(markdown: string): Promise<string> {
      const processor = ensureProcessor(state, options);
      return String(await processor.process(markdown));
    },
    /**
     * Drop cached discovery for stale paths so the next scan re-reads them.
     *
     * @param paths - Stale file paths.
     * @example
     * ```ts
     * provider.invalidate(["content/intro/en.md"]);
     * ```
     */
    invalidate(paths: readonly string[]): void {
      for (const stalePath of paths) {
        if (stalePath.trim() === "") continue;
        state.dirtyPaths.add(stalePath);
      }
      // eslint-disable-next-line unicorn/no-null -- `slugs` is `string[] | null`; reset forces a rescan
      state.slugs = null;
    }
  };
}
