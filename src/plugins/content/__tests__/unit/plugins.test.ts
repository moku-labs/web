import type { Element, Root as HastRoot } from "hast";
import type { Root as MdastRoot } from "mdast";
import { unified } from "unified";
import type { Node } from "unist";
import { visit } from "unist-util-visit";
import { describe, expect, it } from "vitest";
import {
  defaultRehypePlugins,
  defaultRemarkPlugins,
  lazyImagesPlugin,
  pullQuotePlugin,
  sectionDividerPlugin
} from "../../pipeline/plugins";

describe("content/pipeline/plugins", () => {
  it("default remark plugins are a non-empty array of pluggables", () => {
    const remark = defaultRemarkPlugins();
    expect(Array.isArray(remark)).toBe(true);
    expect(remark.length).toBeGreaterThanOrEqual(4);
  });

  it("default remark plugins parse markdown, frontmatter, gfm, directives, and bridge to hast", () => {
    // Build a remark-through-rehype processor from ONLY the framework defaults.
    const processor = unified();
    for (const p of defaultRemarkPlugins()) {
      if (Array.isArray(p)) {
        const [fn, options] = p;
        processor.use(fn as never, options);
      } else {
        processor.use(p as never);
      }
    }
    // GFM table + frontmatter + directive all parse without throwing.
    const md = [
      "---",
      "title: x",
      "---",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      ":::pullquote",
      "quote",
      ":::"
    ].join("\n");
    expect(() => processor.runSync(processor.parse(md))).not.toThrow();
  });

  it("default rehype plugins include the custom transforms (non-empty array)", () => {
    const rehype = defaultRehypePlugins();
    expect(Array.isArray(rehype)).toBe(true);
    expect(rehype.length).toBeGreaterThanOrEqual(2);
  });

  it("lazyImagesPlugin adds loading=lazy to every <img>", () => {
    const transform = lazyImagesPlugin();
    const tree: HastRoot = {
      type: "root",
      children: [
        { type: "element", tagName: "img", properties: { src: "a.png" }, children: [] },
        { type: "element", tagName: "img", properties: { src: "b.png" }, children: [] }
      ]
    };
    transform(tree);
    const imgs: Element[] = [];
    visit(tree, "element", (n: Element) => {
      if (n.tagName === "img") imgs.push(n);
    });
    expect(imgs).toHaveLength(2);
    for (const img of imgs) expect(img.properties?.loading).toBe("lazy");
  });

  it("pullQuotePlugin maps :::pullquote directives to <aside class=pull-quote>", () => {
    const transform = pullQuotePlugin();
    const node = {
      type: "containerDirective",
      name: "pullquote"
    } as unknown as Node & { name: string; data?: Record<string, unknown> };
    const tree: MdastRoot = {
      type: "root",
      children: [node as unknown as MdastRoot["children"][number]]
    };
    transform(tree);
    expect(node.data?.hName).toBe("aside");
    expect((node.data?.hProperties as { class?: string }).class).toBe("pull-quote");
  });

  it("sectionDividerPlugin rewrites <hr> to an ornamental divider", () => {
    const transform = sectionDividerPlugin();
    const tree: HastRoot = {
      type: "root",
      children: [{ type: "element", tagName: "hr", properties: {}, children: [] }]
    };
    transform(tree);
    const div = tree.children[0] as Element;
    expect(div.tagName).toBe("div");
    expect((div.properties as { class?: string }).class).toBe("section-divider");
    const span = div.children[0] as Element;
    expect(span.tagName).toBe("span");
    expect((span.properties as { class?: string }).class).toBe("section-divider-ornament");
  });
});
