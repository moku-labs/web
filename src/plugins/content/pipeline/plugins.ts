/**
 * @file content pipeline — framework default remark/rehype plugin arrays + the
 * three custom transforms (lazy-images, pull-quote, section-divider).
 *
 * Framework default plugin arrays live HERE (and are wired by markdown.ts),
 * NEVER as a config-array default — a config array would be wiped by shallow
 * merge. Consumers extend via additive extraRemarkPlugins / extraRehypePlugins.
 */
import type { Element, Root as HastRoot } from "hast";
import type { Root as MdastRoot } from "mdast";
import rehypeRaw from "rehype-raw";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import type { Pluggable } from "unified";
import type { Node } from "unist";
import { visit } from "unist-util-visit";
import type { FileSystemContentOptions } from "../types";
import { normalizeMermaidOptions, remarkMermaidDiagrams } from "./mermaid";

/** Directive node shape from remark-directive (not in `@types/mdast`). */
type DirectiveNode = Node & {
  type: "containerDirective" | "leafDirective" | "textDirective";
  name: string;
  data?: Record<string, unknown>;
};

/**
 * Type guard for remark-directive nodes (container/leaf/text).
 *
 * @param node - AST node to test.
 * @returns `true` when the node is a directive node.
 * @example
 * ```ts
 * if (isDirectiveNode(node)) console.log(node.name);
 * ```
 */
function isDirectiveNode(node: Node): node is DirectiveNode {
  return (
    node.type === "containerDirective" ||
    node.type === "leafDirective" ||
    node.type === "textDirective"
  );
}

/**
 * Hast transformer adding `loading="lazy"` to every `<img>` element.
 *
 * @param tree - The hast tree to mutate.
 * @example
 * ```ts
 * lazyImagesTransform(tree);
 * ```
 */
function lazyImagesTransform(tree: HastRoot): void {
  visit(tree, "element", (node: Element) => {
    if (node.tagName === "img") {
      node.properties = { ...node.properties, loading: "lazy" };
    }
  });
}

/**
 * Mdast transformer rewriting `:::pullquote` directives to `<aside>` output.
 *
 * @param tree - The mdast tree to mutate.
 * @example
 * ```ts
 * pullQuoteTransform(tree);
 * ```
 */
function pullQuoteTransform(tree: MdastRoot): void {
  visit(tree, (node: Node) => {
    if (isDirectiveNode(node) && node.name === "pullquote") {
      const data = node.data ?? {};
      data.hName = "aside";
      data.hProperties = { class: "pull-quote" };
      node.data = data;
    }
  });
}

/** CSS class for the divider wrapper that replaces an `<hr>`. */
const SECTION_DIVIDER_CLASS = "section-divider";

/** CSS class for the inner ornament span inside the section divider. */
const SECTION_DIVIDER_ORNAMENT_CLASS = "section-divider-ornament";

/** Glyphs rendered inside the section-divider ornament span. */
const SECTION_DIVIDER_ORNAMENT = "***";

/**
 * Rewrite one `<hr>` element in place into an ornamental section divider:
 * a `<div>` wrapper carrying a single ornament `<span>`.
 *
 * @param node - The hast element to rewrite (expected to be an `<hr>`).
 * @example
 * ```ts
 * rewriteHrToDivider(node);
 * ```
 */
function rewriteHrToDivider(node: Element): void {
  // Promote the rule to a styled divider wrapper.
  node.tagName = "div";
  node.properties = { class: SECTION_DIVIDER_CLASS };

  // Replace its (empty) children with the ornament span.
  node.children = [
    {
      type: "element",
      tagName: "span",
      properties: { class: SECTION_DIVIDER_ORNAMENT_CLASS },
      children: [{ type: "text", value: SECTION_DIVIDER_ORNAMENT }]
    }
  ];
}

/**
 * Hast transformer rewriting `<hr>` into an ornamental section divider.
 *
 * @param tree - The hast tree to mutate.
 * @example
 * ```ts
 * sectionDividerTransform(tree);
 * ```
 */
function sectionDividerTransform(tree: HastRoot): void {
  visit(tree, "element", (node: Element) => {
    if (node.tagName !== "hr") return;
    rewriteHrToDivider(node);
  });
}

/**
 * Rehype transform: adds `loading="lazy"` to every `<img>` element so images
 * defer until near the viewport.
 *
 * @returns A hast tree transformer.
 * @example
 * ```ts
 * unified().use(lazyImagesPlugin);
 * ```
 */
export function lazyImagesPlugin(): (tree: HastRoot) => void {
  return lazyImagesTransform;
}

/**
 * Remark transform: rewrites `:::pullquote` container directives to render as
 * `<aside class="pull-quote">` in the output HTML.
 *
 * @returns An mdast tree transformer.
 * @example
 * ```ts
 * unified().use(pullQuotePlugin);
 * ```
 */
export function pullQuotePlugin(): (tree: MdastRoot) => void {
  return pullQuoteTransform;
}

/**
 * Rehype transform: rewrites `<hr>` into an ornamental
 * `<div class="section-divider">` carrying a `***` ornament span.
 *
 * @returns A hast tree transformer.
 * @example
 * ```ts
 * unified().use(sectionDividerPlugin);
 * ```
 */
export function sectionDividerPlugin(): (tree: HastRoot) => void {
  return sectionDividerTransform;
}

/**
 * The hardcoded framework default remark (Markdown-AST) plugins, in order:
 * parse, frontmatter, gfm, directive, pull-quote, the OPT-IN mermaid transform,
 * then the mdast→hast bridge (`remark-rehype` with `allowDangerousHtml`).
 * Pull-quote and mermaid run on the mdast before the bridge — pull-quote so the
 * directive carries its `hName`/`hProperties`, mermaid so the fence is replaced
 * with raw SVG HTML before Shiki could ever claim the code block.
 *
 * @param config - Optional provider configuration; only `mermaid` is read here
 * (truthy enables the mermaid transform at its fixed mdast position).
 * @returns The ordered default remark pluggables.
 * @example
 * ```ts
 * const remark = defaultRemarkPlugins();
 * ```
 */
export function defaultRemarkPlugins(config?: FileSystemContentOptions): readonly Pluggable[] {
  const plugins: Pluggable[] = [
    remarkParse,
    remarkFrontmatter,
    remarkGfm,
    remarkDirective,
    pullQuotePlugin
  ];

  // Mermaid is opt-in and must run at the mdast stage, BEFORE the bridge.
  if (config?.mermaid) {
    plugins.push([remarkMermaidDiagrams, normalizeMermaidOptions(config.mermaid)]);
  }

  plugins.push([remarkRehype, { allowDangerousHtml: true }]);
  return plugins;
}

/**
 * The hardcoded framework default rehype (HTML-AST) plugins, in order:
 * `rehype-raw` (re-parse embedded HTML) then the custom transforms (lazy-images,
 * section-divider). Shiki + sanitize + stringify are appended by markdown.ts.
 *
 * @returns The ordered default rehype pluggables.
 * @example
 * ```ts
 * const rehype = defaultRehypePlugins();
 * ```
 */
export function defaultRehypePlugins(): readonly Pluggable[] {
  return [rehypeRaw, lazyImagesPlugin, sectionDividerPlugin];
}
