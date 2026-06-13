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
 *
 * The `src` may be an http(s) URL, a root-relative path, OR a co-located
 * relative path (`./game/index.html`) pointing at a pre-built static bundle
 * shipped next to the article like its `images/` dir — those relative paths are
 * resolved to the shared `/<slug>/…` URL by the provider (providers.ts) and the
 * bundle is copied to the output by the content-assets build phase. Optional
 * `width`/`height` (integer pixels) reserve the facade's box at its real aspect
 * ratio so the embed never causes layout shift (e.g. a portrait game frame).
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

/** Optional facade dimensions (integer pixels) used to reserve the box. */
type EmbedDimensions = { width: number; height: number };

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
 * Validate an embed `src`. Three forms are embeddable: an `http(s)` URL, a
 * root-relative path (`/x`), or a co-located relative path (`./x`, `../x`,
 * `x/…`) resolved later against `/<slug>/`. Everything else — protocol-relative
 * (`//host`), `javascript:`, `data:`, any other scheme — is rejected.
 *
 * @param src - The raw `src` attribute value.
 * @returns `true` when the URL/path is embeddable.
 * @example
 * ```ts
 * isEmbeddableUrl("https://game.example.com/"); // true
 * isEmbeddableUrl("./game/index.html"); // true (co-located)
 * isEmbeddableUrl("javascript:alert(1)"); // false
 * ```
 */
function isEmbeddableUrl(src: string): boolean {
  if (src === "") return false;
  // Protocol-relative URLs (`//host/…`) inherit the page scheme — reject.
  if (src.startsWith("//")) return false;
  // A leading `scheme:` is only allowed when it is http/https.
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return /^https?:\/\//i.test(src);
  // No scheme: a root-relative or co-located relative path — both embeddable.
  return true;
}

/**
 * Parse + validate the optional `width`/`height` directive attributes. Both
 * must be supplied together, each a positive integer count of pixels; the pair
 * is used to reserve the facade box at its true aspect ratio. Returns
 * `undefined` when neither is set.
 *
 * @param width - Raw `width` attribute (or undefined).
 * @param height - Raw `height` attribute (or undefined).
 * @returns The parsed dimensions, or `undefined` when both are absent.
 * @throws {Error} When only one of the pair is set, or a value is not a
 * positive integer.
 * @example
 * ```ts
 * parseDimensions("400", "711"); // { width: 400, height: 711 }
 * parseDimensions(undefined, undefined); // undefined
 * ```
 */
function parseDimensions(
  width: string | null | undefined,
  height: string | null | undefined
): EmbedDimensions | undefined {
  const hasWidth = width !== undefined && width !== null && width !== "";
  const hasHeight = height !== undefined && height !== null && height !== "";
  if (!hasWidth && !hasHeight) return undefined;
  if (!hasWidth || !hasHeight) {
    throw new Error(
      "[web] content: `::embed` width and height must be set together (got only one)."
    );
  }
  if (!/^\d+$/.test(width) || !/^\d+$/.test(height) || width === "0" || height === "0") {
    throw new Error(
      `[web] content: \`::embed\` width/height must be positive integers in pixels (got "${width}"×"${height}").`
    );
  }
  return { width: Number(width), height: Number(height) };
}

/**
 * Build the static facade HTML for one embed: the `<figure>` carrying the
 * target in data attributes plus the activation `<button>` (the button label
 * is the embed's title; visual chrome is consumer CSS). When dimensions are
 * given, the figure also carries `data-embed-width`/`-height` plus an inline
 * `aspect-ratio`/`max-width` so the box is reserved before activation (no
 * layout shift) and survives because embeds require `trustedContent`.
 *
 * @param src - The validated embed URL/path.
 * @param title - The human-readable embed title (button label, iframe title).
 * @param dimensions - Optional reserved-box pixel dimensions.
 * @returns The facade HTML string.
 * @example
 * ```ts
 * embedFacadeHtml("https://game.example.com/", "My Game", { width: 400, height: 711 });
 * ```
 */
function embedFacadeHtml(src: string, title: string, dimensions?: EmbedDimensions): string {
  const safeSource = escapeAttribute(src);
  const safeTitle = escapeAttribute(title);
  const sizing = dimensions
    ? ` data-embed-width="${dimensions.width}" data-embed-height="${dimensions.height}"` +
      ` style="aspect-ratio: ${dimensions.width} / ${dimensions.height}; max-width: ${dimensions.width}px;"`
    : "";
  return (
    `<figure class="${EMBED_FIGURE_CLASS}" data-component="${EMBED_COMPONENT_NAME}"` +
    ` data-embed-src="${safeSource}" data-embed-title="${safeTitle}"${sizing}>` +
    `<button type="button" class="${EMBED_BUTTON_CLASS}" aria-label="Load embed: ${safeTitle}">` +
    `<span class="${EMBED_TITLE_CLASS}">${safeTitle}</span>` +
    `</button></figure>`
  );
}

/**
 * Mdast transformer rewriting every `::embed` leaf directive to its facade
 * HTML node. A directive missing `src`/`title`, carrying a non-embeddable URL,
 * or carrying invalid `width`/`height`, fails the build with the offending
 * value quoted.
 *
 * @param tree - The mdast tree to mutate.
 * @throws {Error} When an `::embed` directive is missing `src` or `title`, its
 * `src` is not embeddable, or its dimensions are invalid.
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
        `[web] content: \`::embed\` src must be an http(s) URL, a root-relative path, or a co-located relative path (got "${src}").`
      );
    }

    const dimensions = parseDimensions(node.attributes?.width, node.attributes?.height);
    const html: Html = { type: "html", value: embedFacadeHtml(src, title, dimensions) };
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
