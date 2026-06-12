/**
 * @file content pipeline — build-time Mermaid diagram rendering.
 *
 * Rewrites fenced `mermaid` code blocks into static inline SVG at the mdast
 * stage (BEFORE the remark-rehype bridge, so Shiki never sees the fence). The
 * heavy renderer (`mermaid-isomorphic`, a headless browser under the hood) is
 * an OPTIONAL peer dependency, imported LAZILY and only when a document
 * actually contains a mermaid fence — consumers who never write diagrams pay
 * nothing: no install, no import, no browser launch.
 */
import type { Code, Html, Parent as MdastParent, Root as MdastRoot } from "mdast";
import { visit } from "unist-util-visit";
import type { MermaidDiagramOptions } from "../types";

/** CSS class on the `<figure>` wrapper around each rendered diagram. */
const MERMAID_FIGURE_CLASS = "mermaid-diagram";

/**
 * One rendered diagram from mermaid-isomorphic (only `svg` is consumed). Typed
 * loosely on purpose: the dependency is optional, so its types are never imported.
 */
type MermaidRenderResult = { svg: string };

/**
 * The batched renderer returned by mermaid-isomorphic's `createMermaidRenderer`:
 * takes every diagram source of a document, settles one result per source.
 */
type MermaidRenderer = (
  diagrams: string[],
  options?: { mermaidConfig?: Record<string, unknown> }
) => Promise<PromiseSettledResult<MermaidRenderResult>[]>;

/** Module shape of the lazily imported `mermaid-isomorphic` package. */
type MermaidIsomorphicModule = {
  createMermaidRenderer: (options?: Record<string, unknown>) => MermaidRenderer;
};

/** A mermaid fence found in the tree, with the parent/index needed to replace it. */
type FenceSite = {
  /** The mermaid `code` node. */
  node: Code;
  /** Its parent node (replacement happens in `parent.children`). */
  parent: MdastParent;
  /** The node's index within `parent.children`. */
  index: number;
};

/**
 * Cached renderer promise — `createMermaidRenderer()` is called ONCE per process
 * and shared by every document (the underlying headless browser is expensive).
 */
let cachedRendererPromise: Promise<MermaidRenderer> | undefined;

/**
 * Lazily import `mermaid-isomorphic` and create its batched renderer. The import
 * happens HERE (never at module load) so the optional dependency is only touched
 * when a document actually contains a mermaid fence. A failed import is wrapped
 * in an actionable error naming the missing package.
 *
 * @param importModule - Import thunk for the package; injectable so tests can
 * exercise both outcomes without the real dependency. Defaults to the real
 * dynamic `import("mermaid-isomorphic")`.
 * @returns The batched mermaid renderer.
 * @throws {Error} When the optional dependency cannot be loaded.
 * @example
 * ```ts
 * const renderer = await loadMermaidRenderer();
 * const results = await renderer(["graph TD; A-->B"]);
 * ```
 */
export async function loadMermaidRenderer(
  importModule: () => Promise<unknown> = () => import("mermaid-isomorphic")
): Promise<MermaidRenderer> {
  let moduleExports: unknown;
  try {
    moduleExports = await importModule();
  } catch (error) {
    throw new Error(
      '[web] content: `mermaid` is enabled but the optional dependency "mermaid-isomorphic" could not be loaded.\n' +
        "  Install it (plus playwright and a browser):\n" +
        "    bun add -d mermaid-isomorphic playwright && bunx playwright install chromium",
      { cause: error }
    );
  }
  return (moduleExports as MermaidIsomorphicModule).createMermaidRenderer();
}

/**
 * Unwrap mermaid-isomorphic's settled results into plain SVG strings, failing
 * the build on the first rejected diagram. The error quotes the diagram's first
 * line so the author can locate the broken fence.
 *
 * @param sources - The diagram sources, in the order they were rendered.
 * @param results - The settled render results (one per source).
 * @returns One SVG string per source, in order.
 * @throws {Error} When any diagram failed to render.
 * @example
 * ```ts
 * const svgs = unwrapMermaidResults(["graph TD; A-->B"], results);
 * ```
 */
export function unwrapMermaidResults(
  sources: readonly string[],
  results: readonly PromiseSettledResult<MermaidRenderResult>[]
): string[] {
  return results.map((result, index) => {
    if (result.status === "rejected") {
      const firstLine = (sources[index] ?? "").split("\n", 1)[0] ?? "";
      throw new Error(
        `[web] content: mermaid diagram failed to render (diagram starts with "${firstLine}"): ${String(result.reason)}`
      );
    }
    return result.value.svg;
  });
}

/**
 * The REAL render path: lazily load mermaid-isomorphic (cached once per
 * process), render every fence of the document in ONE batched call, and unwrap
 * the results. Replaced in unit tests by the `renderDiagrams` seam.
 *
 * @param sources - Every mermaid fence source of one document, in order.
 * @param mermaidConfig - Optional mermaid configuration forwarded to the render call.
 * @returns One SVG string per source, in order.
 * @example
 * ```ts
 * const svgs = await renderWithMermaidIsomorphic(["graph TD; A-->B"]);
 * ```
 */
async function renderWithMermaidIsomorphic(
  sources: readonly string[],
  mermaidConfig?: Record<string, unknown>
): Promise<readonly string[]> {
  cachedRendererPromise ??= loadMermaidRenderer();
  const renderer = await cachedRendererPromise;
  const results = await renderer([...sources], mermaidConfig ? { mermaidConfig } : undefined);
  return unwrapMermaidResults(sources, results);
}

/**
 * Collect every fenced `mermaid` code block in the tree (with the parent/index
 * needed to replace it later), in document order.
 *
 * @param tree - The mdast tree to scan.
 * @returns The fence sites found.
 * @example
 * ```ts
 * const fences = collectMermaidFences(tree);
 * ```
 */
function collectMermaidFences(tree: MdastRoot): FenceSite[] {
  const fences: FenceSite[] = [];
  visit(tree, "code", (node: Code, index, parent) => {
    if (node.lang !== "mermaid") return;
    if (parent === undefined || index === undefined) return;
    fences.push({ node, parent, index });
  });
  return fences;
}

/**
 * Normalize the provider's `mermaid` config value (`boolean | options`) to a
 * plain {@link MermaidDiagramOptions} object for the transform factory.
 *
 * @param mermaid - The raw `FileSystemContentOptions.mermaid` value (truthy).
 * @returns The options object (`{}` for the bare `true` form).
 * @example
 * ```ts
 * normalizeMermaidOptions(true); // {}
 * normalizeMermaidOptions({ mermaidConfig: { theme: "dark" } });
 * ```
 */
export function normalizeMermaidOptions(
  mermaid: boolean | MermaidDiagramOptions
): MermaidDiagramOptions {
  return typeof mermaid === "boolean" ? {} : mermaid;
}

/**
 * Remark transform factory: replaces every fenced `mermaid` code block with a
 * `<figure class="mermaid-diagram">` raw-HTML node carrying the diagram as
 * static inline SVG, rendered at build time (zero client-side JS). Runs at the
 * mdast stage, BEFORE remark-rehype; the bridge's `allowDangerousHtml` plus the
 * framework's `rehype-raw` default carry the SVG into the output. Documents
 * without a mermaid fence return immediately — `mermaid-isomorphic` is never
 * imported on that path. A diagram that fails to render fails the build with
 * its first line quoted.
 *
 * @param options - Mermaid options: `mermaidConfig` pass-through + the
 * test-only `renderDiagrams` seam.
 * @returns An async mdast tree transformer.
 * @example
 * ```ts
 * unified().use(remarkMermaidDiagrams, { mermaidConfig: { theme: "dark" } });
 * ```
 */
export function remarkMermaidDiagrams(
  options: MermaidDiagramOptions = {}
): (tree: MdastRoot) => Promise<void> {
  return async (tree: MdastRoot): Promise<void> => {
    // Zero-cost path: no mermaid fences → return before any lazy import.
    const fences = collectMermaidFences(tree);
    if (fences.length === 0) return;

    // Render EVERY fence of the document in one batched renderer call.
    const sources = fences.map(fence => fence.node.value);
    const render = options.renderDiagrams ?? renderWithMermaidIsomorphic;
    const svgs = await render(sources, options.mermaidConfig);
    if (svgs.length !== sources.length) {
      throw new Error(
        `[web] content: mermaid renderer returned ${svgs.length} result(s) for ${sources.length} diagram(s).`
      );
    }

    // Replace each fence with a raw-HTML <figure> carrying its inline SVG.
    for (const [position, fence] of fences.entries()) {
      const html: Html = {
        type: "html",
        value: `<figure class="${MERMAID_FIGURE_CLASS}">${svgs[position] ?? ""}</figure>`
      };
      fence.parent.children[fence.index] = html;
    }
  };
}
