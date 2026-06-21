/**
 * @file content pipeline — `::gallery` folder galleries.
 *
 * Rewrites `::gallery{src="./images/dir/" caption="…"}` leaf directives into a
 * static swipeable image set at the mdast stage (BEFORE the remark-rehype bridge):
 * a framework-owned `<div class="gallery" data-island="gallery">` carrying the
 * island hook, wrapping inner content rendered (at build time, to static markup)
 * by a Preact component — the built-in {@link GalleryTrack} by default, or a
 * consumer component via `gallery.component`.
 *
 * Unlike `::embed` (one src resolved later by the provider), a gallery's `src` is a
 * co-located FOLDER that must be listed at build time, which needs the article's
 * source path. The provider supplies the article `slug` via the VFile `data`
 * (providers.ts), and the `contentDir` is bound at pipeline-build time — so this
 * transform reads `<contentDir>/<slug>/<src>` from disk, sorts its images, and
 * resolves each to its shared `/<slug>/<dir>/<file>` URL (identical from every
 * locale page, mirroring co-located images). The companion gallery SPA island
 * (consumer-provided) wires swipe/keyboard/lightbox on `[data-island="gallery"]`.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import type { Html, Parent as MdastParent, Root as MdastRoot } from "mdast";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { Node } from "unist";
import { visit } from "unist-util-visit";
import type { VFile } from "vfile";
import type {
  GalleryComponent,
  GalleryOptions,
  GallerySlide,
  GalleryTransformOptions
} from "../types";
import { GalleryTrack } from "./gallery-default";

/** CSS class on the `<div>` wrapping each gallery. */
const GALLERY_WRAPPER_CLASS = "gallery";

/** `data-island` name binding the gallery to its SPA island. */
const GALLERY_ISLAND_NAME = "gallery";

/** Image file extensions a gallery folder expands over. */
const IMAGE_EXTENSIONS = new Set([".webp", ".jpg", ".jpeg", ".png", ".gif", ".avif"]);

/** Leaf-directive node shape from remark-directive (not in `@types/mdast`). */
type GalleryDirectiveNode = Node & {
  type: "leafDirective";
  name: string;
  attributes?: Record<string, string | null | undefined>;
};

/**
 * Type guard for a `::gallery` leaf directive.
 *
 * @param node - AST node to test.
 * @returns `true` when the node is a `::gallery` leaf directive.
 * @example
 * ```ts
 * if (isGalleryDirective(node)) console.log(node.attributes?.src);
 * ```
 */
function isGalleryDirective(node: Node): node is GalleryDirectiveNode {
  return node.type === "leafDirective" && (node as GalleryDirectiveNode).name === "gallery";
}

/**
 * Resolve `.`/`..` segments of a path built from `slug/src/file` into the single
 * shared absolute URL the content-assets build phase copies the folder to.
 *
 * @param slug - Article directory name.
 * @param src - The directive `src` (co-located relative folder, e.g. `./images/dir/`).
 * @param file - One image file name inside the folder.
 * @returns The shared absolute slide URL (`/<slug>/<dir>/<file>`).
 * @example
 * ```ts
 * slideUrl("post", "./images/mk/", "a.webp"); // "/post/images/mk/a.webp"
 * ```
 */
function slideUrl(slug: string, src: string, file: string): string {
  const resolved: string[] = [];
  for (const segment of `${slug}/${src}/${file}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return `/${resolved.join("/")}`;
}

/**
 * Read a gallery folder from disk and build its sorted slide list. Each slide
 * gets the directive `caption` plus a ` · N` index suffix as alt (or just `N`).
 *
 * @param contentDir - The provider's content directory.
 * @param slug - Article directory name (from the VFile data).
 * @param src - The directive `src` (co-located relative folder).
 * @param caption - The directive `caption` attribute (may be empty).
 * @returns The sorted slides.
 * @throws {Error} When the folder is missing or holds no images.
 * @example
 * ```ts
 * resolveSlides("./content", "post", "./images/mk/", "Our game");
 * ```
 */
function resolveSlides(
  contentDir: string,
  slug: string,
  src: string,
  caption: string
): GallerySlide[] {
  const folder = path.join(contentDir, slug, src);

  let entries: string[];
  try {
    entries = readdirSync(folder);
  } catch {
    throw new Error(
      `[web] content: \`::gallery\` folder not found: "${src}" (looked in ${folder}).`
    );
  }

  const files = entries
    .filter(name => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .toSorted((a, b) => a.localeCompare(b, "en"));
  if (files.length === 0) {
    throw new Error(`[web] content: \`::gallery\` folder has no images: "${src}" (${folder}).`);
  }

  return files.map((file, index) => ({
    src: slideUrl(slug, src, file),
    alt: caption ? `${caption} · ${index + 1}` : `${index + 1}`
  }));
}

/**
 * Collect the directive's raw attribute bag into a plain string record, dropping
 * `null`/`undefined` values (so a custom component can read arbitrary extra options).
 *
 * @param attributes - The raw directive attributes (or undefined).
 * @returns A string-valued attribute record.
 * @example
 * ```ts
 * collectAttributes({ src: "x", layout: "dots", flag: null }); // { src: "x", layout: "dots" }
 * ```
 */
function collectAttributes(
  attributes: Record<string, string | null | undefined> | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * Build the static gallery HTML for one directive: the framework-owned `<div>`
 * (island hook in `data-island`) wrapping the component's inner content, SSR'd
 * to static markup.
 *
 * @param component - The gallery component (default {@link GalleryTrack}).
 * @param slides - The resolved slides.
 * @param caption - The directive `caption` attribute.
 * @param attributes - The raw directive attribute bag.
 * @returns The gallery HTML string.
 * @example
 * ```ts
 * galleryHtml(GalleryTrack, slides, "Our game", { src: "./images/mk/" });
 * ```
 */
function galleryHtml(
  component: GalleryComponent,
  slides: readonly GallerySlide[],
  caption: string,
  attributes: Record<string, string>
): string {
  const inner = renderToString(h(component, { slides, caption, attributes }));
  return (
    `<div class="${GALLERY_WRAPPER_CLASS}" data-island="${GALLERY_ISLAND_NAME}">` + `${inner}</div>`
  );
}

/**
 * Mdast transformer rewriting every `::gallery` leaf directive to its gallery
 * HTML node. A directive missing `src`, or pointing at a missing/empty folder,
 * fails the build with the offending value quoted. Skipped entirely when the
 * VFile carries no `slug` (the standalone `render()` path has no article context).
 *
 * @param options - Resolved transform options (component + contentDir).
 * @param tree - The mdast tree to mutate.
 * @param file - The VFile (its `data.slug` locates the article on disk).
 * @throws {Error} When a `::gallery` directive is missing `src`, or its folder is
 * missing/empty.
 * @example
 * ```ts
 * galleryTransform({ component: GalleryTrack, contentDir: "./content" }, tree, file);
 * ```
 */
function galleryTransform(options: GalleryTransformOptions, tree: MdastRoot, file: VFile): void {
  const slug = typeof file.data.slug === "string" ? file.data.slug : undefined;
  const component = options.component ?? GalleryTrack;

  visit(tree, (node: Node, index, parent) => {
    if (!isGalleryDirective(node)) return;
    if (parent === undefined || index === undefined) return;
    // No article context (standalone render) — leave the directive untouched.
    if (slug === undefined) return;

    const src = node.attributes?.src ?? "";
    if (src === "") {
      throw new Error(
        '[web] content: `::gallery` requires a `src` folder, e.g. ::gallery{src="./images/dir/"}.'
      );
    }

    const caption = node.attributes?.caption ?? "";
    const slides = resolveSlides(options.contentDir, slug, src, caption);
    const attributes = collectAttributes(node.attributes);
    const html: Html = { type: "html", value: galleryHtml(component, slides, caption, attributes) };
    (parent as MdastParent).children[index] = html;
  });
}

/**
 * Normalize the provider's `gallery` config value (`boolean | options`) plus the
 * provider `contentDir` into the resolved {@link GalleryTransformOptions} the
 * transform factory needs.
 *
 * @param gallery - The raw `FileSystemContentOptions.gallery` value (truthy).
 * @param contentDir - The provider's content directory.
 * @returns The resolved transform options.
 * @example
 * ```ts
 * normalizeGalleryOptions(true, "./content"); // { contentDir: "./content" }
 * normalizeGalleryOptions({ component: MyGallery }, "./content");
 * ```
 */
export function normalizeGalleryOptions(
  gallery: boolean | GalleryOptions,
  contentDir: string
): GalleryTransformOptions {
  return typeof gallery === "boolean" ? { contentDir } : { ...gallery, contentDir };
}

/**
 * Remark transform factory: rewrites `::gallery{src="…"}` leaf directives into
 * static swipeable galleries (see the file header). Opt-in via the provider's
 * `gallery` option; requires `trustedContent: true` because the markup is raw HTML
 * the sanitize pass would strip. The inner content is rendered by
 * `options.component` (a consumer Preact component) or the built-in
 * {@link GalleryTrack}; folders are read from `options.contentDir` against the
 * per-article `slug` on the VFile.
 *
 * @param options - Resolved transform options (component + contentDir).
 * @returns An mdast tree transformer.
 * @example
 * ```ts
 * unified().use(galleryPlugin, { component: MyGallery, contentDir: "./content" });
 * ```
 */
export function galleryPlugin(
  options: GalleryTransformOptions
): (tree: MdastRoot, file: VFile) => void {
  return (tree: MdastRoot, file: VFile) => galleryTransform(options, tree, file);
}
