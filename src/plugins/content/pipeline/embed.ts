/**
 * @file content pipeline — `::embed` lazy iframe facades.
 *
 * Rewrites `::embed{src="…" title="…"}` leaf directives into a static
 * click-to-activate facade at the mdast stage (BEFORE the remark-rehype
 * bridge): a `<figure class="lazy-embed">` carrying the target URL in data
 * attributes plus an activation `<button>`. NO iframe is emitted at build time
 * — the page never loads the embedded document until the reader asks for it,
 * so an embed costs the article nothing (no network, no scroll-jacking, no
 * third-party JS). The companion `lazyEmbed` SPA island (plugins/spa/lazy-embed.ts)
 * swaps the facade for a real `<iframe loading="lazy">` on click.
 */
import type { Html, Parent as MdastParent, Root as MdastRoot } from "mdast";
import type { Node } from "unist";
import { visit } from "unist-util-visit";

/** CSS class on the `<figure>` facade wrapping each embed. */
const EMBED_FIGURE_CLASS = "lazy-embed";

/** `data-component` name binding the facade to the `lazyEmbed` SPA island. */
const EMBED_COMPONENT_NAME = "lazy-embed";

/** CSS class on the facade's activation button. */
const EMBED_BUTTON_CLASS = "lazy-embed-button";

/** CSS class on the title span inside the activation button. */
const EMBED_TITLE_CLASS = "lazy-embed-title";

/** Leaf-directive node shape from remark-directive (not in `@types/mdast`). */
type EmbedDirectiveNode = Node & {
  type: "leafDirective";
  name: string;
  attributes?: Record<string, string | null | undefined>;
};

/**
 * Type guard for an `::embed` leaf directive.
 *
 * @param node - AST node to test.
 * @returns `true` when the node is an `::embed` leaf directive.
 * @example
 * ```ts
 * if (isEmbedDirective(node)) console.log(node.attributes?.src);
 * ```
 */
function isEmbedDirective(node: Node): node is EmbedDirectiveNode {
  return node.type === "leafDirective" && (node as EmbedDirectiveNode).name === "embed";
}

/**
 * Escape a string for safe interpolation into a double-quoted HTML attribute.
 *
 * @param value - The raw attribute value.
 * @returns The escaped value.
 * @example
 * ```ts
 * escapeAttribute('He said "hi" & left'); // "He said &quot;hi&quot; &amp; left"
 * ```
 */
function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Validate an embed `src` URL: only `https:`/`http:` absolute URLs and
 * root-relative paths are embeddable — anything else (`javascript:`, `data:`,
 * scheme-relative, …) fails the build.
 *
 * @param src - The raw `src` attribute value.
 * @returns `true` when the URL is embeddable.
 * @example
 * ```ts
 * isEmbeddableUrl("https://game.example.com/"); // true
 * isEmbeddableUrl("javascript:alert(1)"); // false
 * ```
 */
function isEmbeddableUrl(src: string): boolean {
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  return /^https?:\/\//i.test(src);
}

/**
 * Build the static facade HTML for one embed: the `<figure>` carrying the
 * target in data attributes plus the activation `<button>` (the button label
 * is the embed's title; visual chrome is consumer CSS).
 *
 * @param src - The validated embed URL.
 * @param title - The human-readable embed title (button label, iframe title).
 * @returns The facade HTML string.
 * @example
 * ```ts
 * embedFacadeHtml("https://game.example.com/", "My Game");
 * ```
 */
function embedFacadeHtml(src: string, title: string): string {
  const safeSource = escapeAttribute(src);
  const safeTitle = escapeAttribute(title);
  return (
    `<figure class="${EMBED_FIGURE_CLASS}" data-component="${EMBED_COMPONENT_NAME}"` +
    ` data-embed-src="${safeSource}" data-embed-title="${safeTitle}">` +
    `<button type="button" class="${EMBED_BUTTON_CLASS}" aria-label="Load embed: ${safeTitle}">` +
    `<span class="${EMBED_TITLE_CLASS}">${safeTitle}</span>` +
    `</button></figure>`
  );
}

/**
 * Mdast transformer rewriting every `::embed` leaf directive to its facade
 * HTML node. A directive missing `src`/`title`, or carrying a non-embeddable
 * URL, fails the build with the offending value quoted.
 *
 * @param tree - The mdast tree to mutate.
 * @throws {Error} When an `::embed` directive is missing `src` or `title`, or
 * its `src` is not an embeddable URL.
 * @example
 * ```ts
 * embedTransform(tree);
 * ```
 */
function embedTransform(tree: MdastRoot): void {
  visit(tree, (node: Node, index, parent) => {
    if (!isEmbedDirective(node)) return;
    if (parent === undefined || index === undefined) return;

    const src = node.attributes?.src ?? "";
    const title = node.attributes?.title ?? "";
    if (src === "" || title === "") {
      throw new Error(
        '[web] content: `::embed` requires both `src` and `title` attributes, e.g. ::embed{src="https://…" title="…"}.'
      );
    }
    if (!isEmbeddableUrl(src)) {
      throw new Error(
        `[web] content: \`::embed\` src must be an http(s) URL or a root-relative path (got "${src}").`
      );
    }

    const html: Html = { type: "html", value: embedFacadeHtml(src, title) };
    (parent as MdastParent).children[index] = html;
  });
}

/**
 * Remark transform: rewrites `::embed{src="…" title="…"}` leaf directives into
 * static click-to-activate facades (no iframe until the reader clicks — see
 * the file header). Opt-in via the provider's `embed` option; requires
 * `trustedContent: true` because the facade is raw HTML the sanitize pass
 * would strip.
 *
 * @returns An mdast tree transformer.
 * @example
 * ```ts
 * unified().use(embedPlugin);
 * ```
 */
export function embedPlugin(): (tree: MdastRoot) => void {
  return embedTransform;
}
