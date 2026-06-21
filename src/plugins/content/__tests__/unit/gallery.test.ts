import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Html, Root as MdastRoot } from "mdast";
import { h } from "preact";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { VFile } from "vfile";
import { describe, expect, it } from "vitest";
import { galleryPlugin, normalizeGalleryOptions } from "../../pipeline/gallery";
import type { GalleryProps } from "../../types";
import { validateFileSystemContentOptions } from "../../validate";

/** A custom gallery component: a `<figure>` with a caption and the slide imgs. */
const FigureGallery = (props: GalleryProps) =>
  h("figure", {}, [
    h("figcaption", {}, props.caption),
    ...props.slides.map(s => h("img", { src: s.src, alt: s.alt }))
  ]);

/** A custom gallery component echoing the `layout` directive attribute. */
const LayoutGallery = (props: GalleryProps) =>
  h("div", { "data-layout": props.attributes.layout }, "");

/** Parse markdown (with directive syntax) into an mdast tree. */
function parse(md: string): MdastRoot {
  return unified().use(remarkParse).use(remarkDirective).parse(md);
}

/** Collect every html node's value, in document order. */
function htmlValues(tree: MdastRoot): string[] {
  const values: string[] = [];
  visit(tree, "html", (node: Html) => {
    values.push(node.value);
  });
  return values;
}

/**
 * Build a throwaway content dir holding `post/images/mk/<files>` and return its root.
 * Files are written in the given (possibly unsorted) order to prove output sorting.
 */
function fixture(files: string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), "moku-gallery-"));
  const dir = path.join(root, "post", "images", "mk");
  mkdirSync(dir, { recursive: true });
  for (const name of files) writeFileSync(path.join(dir, name), "x");
  return root;
}

/** Run the gallery transform for slug "post" against a fixture and return the html node values. */
function transform(
  md: string,
  contentDir: string,
  options?: Partial<Parameters<typeof galleryPlugin>[0]>
): string[] {
  const tree = parse(md);
  const file = new VFile({ value: md, data: { slug: "post" } });
  galleryPlugin({ contentDir, ...options })(tree, file);
  return htmlValues(tree);
}

describe("content/pipeline/gallery", () => {
  it("leaves a document without ::gallery directives untouched", () => {
    const root = fixture(["01-a.webp"]);
    const tree = parse(["# Title", "", '::video{src="x"}', "", "plain text"].join("\n"));
    const before = JSON.stringify(tree);

    galleryPlugin({ contentDir: root })(tree, new VFile({ data: { slug: "post" } }));

    expect(JSON.stringify(tree)).toBe(before);
  });

  it("rewrites ::gallery to a wrapper div with the island hook and the default track", () => {
    const root = fixture(["01-a.webp", "02-b.webp"]);
    const [html] = transform('::gallery{src="./images/mk/" caption="Our game"}', root);

    expect(html).toContain('<div class="gallery" data-island="gallery">');
    expect(html).toContain("data-gallery-track");
    expect(html).toContain('<img src="/post/images/mk/01-a.webp" alt="Our game · 1"');
    expect(html).toContain('<img src="/post/images/mk/02-b.webp" alt="Our game · 2"');
  });

  it("sorts slides by filename regardless of on-disk order", () => {
    const root = fixture(["03-c.webp", "01-a.webp", "02-b.webp"]);
    const [html = ""] = transform('::gallery{src="./images/mk/"}', root);

    const order = [...html.matchAll(/\/post\/images\/mk\/([^"]+)/g)].map(m => m[1]);
    expect(order).toEqual(["01-a.webp", "02-b.webp", "03-c.webp"]);
  });

  it("numbers alt text when no caption is given", () => {
    const root = fixture(["01-a.webp", "02-b.webp"]);
    const [html = ""] = transform('::gallery{src="./images/mk/"}', root);

    expect(html).toContain('alt="1"');
    expect(html).toContain('alt="2"');
  });

  it("ignores non-image files in the folder", () => {
    const root = fixture(["01-a.webp", "notes.txt", "02-b.webp", ".DS_Store"]);
    const [html = ""] = transform('::gallery{src="./images/mk/"}', root);

    const imgs = [...html.matchAll(/<img\b/g)].length;
    expect(imgs).toBe(2);
  });

  it("renders a consumer component with the resolved slides + caption", () => {
    const root = fixture(["01-a.webp", "02-b.webp"]);
    const [html = ""] = transform('::gallery{src="./images/mk/" caption="Cap"}', root, {
      component: FigureGallery
    });

    expect(html).toContain("<figure>");
    expect(html).toContain("<figcaption>Cap</figcaption>");
    expect(html).toContain('src="/post/images/mk/01-a.webp"');
  });

  it("passes custom directive attributes through to the component", () => {
    const root = fixture(["01-a.webp"]);
    const [html = ""] = transform('::gallery{src="./images/mk/" layout="dots"}', root, {
      component: LayoutGallery
    });

    expect(html).toContain('data-layout="dots"');
  });

  it("throws when ::gallery has no src", () => {
    const root = fixture(["01-a.webp"]);
    expect(() => transform('::gallery{caption="x"}', root)).toThrow(/requires a `src` folder/);
  });

  it("throws when the folder is missing", () => {
    const root = fixture(["01-a.webp"]);
    expect(() => transform('::gallery{src="./images/missing/"}', root)).toThrow(/folder not found/);
  });

  it("throws when the folder holds no images", () => {
    const root = mkdtempSync(path.join(tmpdir(), "moku-gallery-empty-"));
    mkdirSync(path.join(root, "post", "images", "empty"), { recursive: true });
    expect(() => transform('::gallery{src="./images/empty/"}', root)).toThrow(/no images/);
  });

  it("leaves the directive untouched when the VFile carries no slug (standalone render)", () => {
    const root = fixture(["01-a.webp"]);
    const tree = parse('::gallery{src="./images/mk/"}');
    galleryPlugin({ contentDir: root })(tree, new VFile({ data: {} }));

    expect(htmlValues(tree)).toEqual([]);
  });

  describe("normalizeGalleryOptions", () => {
    it("maps the bare `true` form to just the contentDir", () => {
      expect(normalizeGalleryOptions(true, "./content")).toEqual({ contentDir: "./content" });
    });

    it("merges an options object with the contentDir", () => {
      const opts = normalizeGalleryOptions({ component: FigureGallery }, "./content");
      expect(opts.contentDir).toBe("./content");
      expect(opts.component).toBe(FigureGallery);
    });
  });

  describe("validateFileSystemContentOptions — gallery gate", () => {
    it("throws when gallery is enabled without trustedContent", () => {
      expect(() =>
        validateFileSystemContentOptions({ contentDir: "./content", gallery: true })
      ).toThrow(/`gallery` requires `trustedContent: true`/);
    });

    it("accepts gallery with trustedContent: true", () => {
      expect(() =>
        validateFileSystemContentOptions({
          contentDir: "./content",
          trustedContent: true,
          gallery: true
        })
      ).not.toThrow();
    });
  });
});
