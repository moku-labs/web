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

/** Matches an `<img>` `src` that points at the co-located `images/` dir (relative or root-relative). */
const RELATIVE_IMAGE_SRC = /(<img\b[^>]*?\bsrc=")(?:\.?\/)?images\//g;

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
      const { frontmatter, body } = parseFrontmatter(raw, options);
      const processor = ensureProcessor(state, options);
      const html = rewriteImageUrls(String(await processor.process(body)), slug);
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
