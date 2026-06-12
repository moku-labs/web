import type { Code, Html, Root as MdastRoot } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { describe, expect, it } from "vitest";
import {
  loadMermaidRenderer,
  normalizeMermaidOptions,
  remarkMermaidDiagrams,
  unwrapMermaidResults
} from "../../pipeline/mermaid";
import { fileSystemContent } from "../../providers";
import type { MermaidDiagramOptions } from "../../types";
import { validateFileSystemContentOptions } from "../../validate";

/** Parse markdown into an mdast tree (the stage the mermaid transform runs at). */
function parse(md: string): MdastRoot {
  return unified().use(remarkParse).parse(md);
}

/** Collect every html node's value, in document order. */
function htmlValues(tree: MdastRoot): string[] {
  const values: string[] = [];
  visit(tree, "html", (node: Html) => {
    values.push(node.value);
  });
  return values;
}

/** Collect every remaining code node's lang, in document order. */
function codeLangs(tree: MdastRoot): (string | null | undefined)[] {
  const langs: (string | null | undefined)[] = [];
  visit(tree, "code", (node: Code) => {
    langs.push(node.lang);
  });
  return langs;
}

/** A recording fake for the renderDiagrams test seam. */
function fakeRenderer(svgs: readonly string[]) {
  const calls: { sources: readonly string[]; mermaidConfig?: Record<string, unknown> }[] = [];
  const renderDiagrams: NonNullable<MermaidDiagramOptions["renderDiagrams"]> = (
    sources,
    mermaidConfig
  ) => {
    calls.push(mermaidConfig === undefined ? { sources } : { sources, mermaidConfig });
    return Promise.resolve(svgs);
  };
  return { calls, renderDiagrams };
}

/** A renderDiagrams seam that fails the test if it is ever invoked. */
const neverRender: NonNullable<MermaidDiagramOptions["renderDiagrams"]> = () => {
  throw new Error("renderDiagrams must not be called for this document");
};

/** An import thunk simulating the optional dependency being absent. */
const failingImport = () => Promise.reject(new Error("Cannot find module"));

/** A stand-in batched renderer returned by the fake module below. */
const stubRenderer = () =>
  Promise.resolve([{ status: "fulfilled" as const, value: { svg: "<svg/>" } }]);

describe("content/pipeline/mermaid", () => {
  it("leaves a document without mermaid fences untouched and never invokes the renderer", async () => {
    const tree = parse(["# Title", "", "```ts", "const x = 1;", "```"].join("\n"));
    const before = JSON.stringify(tree);

    await remarkMermaidDiagrams({ renderDiagrams: neverRender })(tree);

    expect(JSON.stringify(tree)).toBe(before);
    expect(codeLangs(tree)).toEqual(["ts"]);
  });

  it("replaces a single mermaid fence with a <figure class=mermaid-diagram> html node", async () => {
    const tree = parse(["before", "", "```mermaid", "graph TD", "A-->B", "```"].join("\n"));
    const { calls, renderDiagrams } = fakeRenderer(["<svg>one</svg>"]);

    await remarkMermaidDiagrams({ renderDiagrams })(tree);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sources).toEqual(["graph TD\nA-->B"]);
    expect(htmlValues(tree)).toEqual(['<figure class="mermaid-diagram"><svg>one</svg></figure>']);
    // The mermaid code node itself is gone.
    expect(codeLangs(tree)).toEqual([]);
  });

  it("batches multiple fences into ONE renderer call and replaces them in order", async () => {
    const tree = parse(
      [
        "```mermaid",
        "graph TD",
        "```",
        "",
        "```ts",
        "const keep = true;",
        "```",
        "",
        "```mermaid",
        "sequenceDiagram",
        "```"
      ].join("\n")
    );
    const { calls, renderDiagrams } = fakeRenderer(["<svg>first</svg>", "<svg>second</svg>"]);

    await remarkMermaidDiagrams({ renderDiagrams })(tree);

    // Exactly ONE batched call carrying both sources, in document order.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sources).toEqual(["graph TD", "sequenceDiagram"]);
    // Replacements land in order; the non-mermaid fence is untouched.
    expect(htmlValues(tree)).toEqual([
      '<figure class="mermaid-diagram"><svg>first</svg></figure>',
      '<figure class="mermaid-diagram"><svg>second</svg></figure>'
    ]);
    expect(codeLangs(tree)).toEqual(["ts"]);
  });

  it("forwards mermaidConfig to the renderer", async () => {
    const tree = parse("```mermaid\ngraph TD\n```");
    const { calls, renderDiagrams } = fakeRenderer(["<svg/>"]);

    await remarkMermaidDiagrams({ mermaidConfig: { theme: "dark" }, renderDiagrams })(tree);

    expect(calls[0]?.mermaidConfig).toEqual({ theme: "dark" });
  });

  it("throws when the renderer returns a result-count mismatch", async () => {
    const tree = parse("```mermaid\ngraph TD\n```");
    const { renderDiagrams } = fakeRenderer([]);

    await expect(remarkMermaidDiagrams({ renderDiagrams })(tree)).rejects.toThrow(
      /returned 0 result\(s\) for 1 diagram\(s\)/
    );
  });

  it("unwrapMermaidResults returns the svgs in order on success", () => {
    const svgs = unwrapMermaidResults(
      ["graph TD", "sequenceDiagram"],
      [
        { status: "fulfilled", value: { svg: "<svg>a</svg>" } },
        { status: "fulfilled", value: { svg: "<svg>b</svg>" } }
      ]
    );
    expect(svgs).toEqual(["<svg>a</svg>", "<svg>b</svg>"]);
  });

  it("unwrapMermaidResults throws quoting the failing diagram's first line", () => {
    expect(() =>
      unwrapMermaidResults(
        ["graph TD\nA-->B"],
        [{ status: "rejected", reason: new Error("Parse error on line 2") }]
      )
    ).toThrow(/diagram starts with "graph TD".*Parse error on line 2/);
  });

  it("loadMermaidRenderer wraps a failed import in an error naming mermaid-isomorphic", async () => {
    await expect(loadMermaidRenderer(failingImport)).rejects.toThrow(
      /"mermaid-isomorphic" could not be loaded[\S\s]*bun add -d mermaid-isomorphic playwright/
    );
  });

  it("loadMermaidRenderer returns the imported module's batched renderer", async () => {
    const moduleExports = { createMermaidRenderer: () => stubRenderer };
    await expect(loadMermaidRenderer(() => Promise.resolve(moduleExports))).resolves.toBe(
      stubRenderer
    );
  });

  it("normalizeMermaidOptions maps booleans to {} and passes option objects through", () => {
    expect(normalizeMermaidOptions(true)).toEqual({});
    expect(normalizeMermaidOptions(false)).toEqual({});
    const options: MermaidDiagramOptions = { mermaidConfig: { theme: "dark" } };
    expect(normalizeMermaidOptions(options)).toBe(options);
  });

  describe("config validation (mermaid requires trustedContent)", () => {
    it("rejects mermaid without trustedContent: true at provider construction", () => {
      expect(() => fileSystemContent({ contentDir: "./content", mermaid: true })).toThrow(
        /`mermaid` requires `trustedContent: true`/
      );
      expect(() =>
        validateFileSystemContentOptions({
          contentDir: "./content",
          trustedContent: false,
          mermaid: { mermaidConfig: {} }
        })
      ).toThrow(/raw inline SVG/);
    });

    it("accepts mermaid with trustedContent: true", () => {
      expect(() =>
        fileSystemContent({ contentDir: "./content", trustedContent: true, mermaid: true })
      ).not.toThrow();
    });

    it("accepts untrusted content while mermaid stays disabled", () => {
      expect(() => fileSystemContent({ contentDir: "./content" })).not.toThrow();
      expect(() =>
        validateFileSystemContentOptions({ contentDir: "./content", mermaid: false })
      ).not.toThrow();
    });
  });

  describe("end-to-end through the provider pipeline (ensureProcessor)", () => {
    it("renders a mermaid fence to a figure-wrapped inline SVG in the output HTML", async () => {
      const { calls, renderDiagrams } = fakeRenderer(['<svg viewBox="0 0 8 8"><g></g></svg>']);
      const provider = fileSystemContent({
        contentDir: "./content",
        trustedContent: true,
        mermaid: { renderDiagrams }
      });

      const html = await provider.render(
        ["# Diagram", "", "```mermaid", "graph TD", "A-->B", "```"].join("\n")
      );

      expect(calls).toHaveLength(1);
      expect(html).toContain('<figure class="mermaid-diagram"><svg');
      expect(html).toContain("</figure>");
      expect(html).toContain("<h1");
    });

    it("renders normally (renderer never invoked) when mermaid is enabled but unused", async () => {
      const provider = fileSystemContent({
        contentDir: "./content",
        trustedContent: true,
        mermaid: { renderDiagrams: neverRender }
      });

      const html = await provider.render(
        ["# Plain", "", "```ts", "const x = 1;", "```"].join("\n")
      );

      expect(html).toContain("<h1");
      expect(html).toContain("shiki");
    });
  });
});
