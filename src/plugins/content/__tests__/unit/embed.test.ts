import type { Html, Root as MdastRoot } from "mdast";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { describe, expect, it } from "vitest";
import { embedPlugin } from "../../pipeline/embed";
import { validateFileSystemContentOptions } from "../../validate";

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

/** Run the embed transform over markdown and return the html node values. */
function transform(md: string): string[] {
  const tree = parse(md);
  embedPlugin()(tree);
  return htmlValues(tree);
}

describe("content/pipeline/embed", () => {
  it("leaves a document without ::embed directives untouched", () => {
    const tree = parse(["# Title", "", '::video{src="x"}', "", "plain text"].join("\n"));
    const before = JSON.stringify(tree);

    embedPlugin()(tree);

    expect(JSON.stringify(tree)).toBe(before);
  });

  it("rewrites ::embed to a facade figure with data attributes and a button", () => {
    const [html] = transform('::embed{src="https://game.example.com/" title="My Game"}');

    expect(html).toContain('<figure class="lazy-embed" data-component="lazy-embed"');
    expect(html).toContain('data-embed-src="https://game.example.com/"');
    expect(html).toContain('data-embed-title="My Game"');
    expect(html).toContain('<button type="button" class="lazy-embed-button"');
    expect(html).toContain('aria-label="Load embed: My Game"');
    expect(html).toContain('<span class="lazy-embed-title">My Game</span>');
    expect(html).not.toContain("<iframe");
  });

  it("accepts a root-relative src", () => {
    const [html] = transform('::embed{src="/games/screw-master/" title="Local"}');

    expect(html).toContain('data-embed-src="/games/screw-master/"');
  });

  it("escapes HTML metacharacters in attribute values", () => {
    const [html] = transform(
      '::embed{src="https://example.com/?a=1&b=2" title=\'He said "play" & <left>\'}'
    );

    expect(html).toContain('data-embed-src="https://example.com/?a=1&amp;b=2"');
    expect(html).toContain('data-embed-title="He said &quot;play&quot; &amp; &lt;left&gt;"');
    expect(html).not.toContain("<left>");
  });

  it("fails the build when src is missing", () => {
    expect(() => transform('::embed{title="No Src"}')).toThrow(/requires both `src` and `title`/);
  });

  it("fails the build when title is missing", () => {
    expect(() => transform('::embed{src="https://example.com/"}')).toThrow(
      /requires both `src` and `title`/
    );
  });

  it("fails the build on non-embeddable URLs", () => {
    for (const src of ["javascript:alert(1)", "data:text/html,hi", "//evil.example.com/"]) {
      expect(() => transform(`::embed{src="${src}" title="Nope"}`)).toThrow(
        /must be an http\(s\) URL or a root-relative path/
      );
    }
  });

  it("uses the [web] error prefix", () => {
    expect(() => transform('::embed{title="No Src"}')).toThrow(/^\[web\]/);
  });
});

describe("validateFileSystemContentOptions — embed gate", () => {
  it("throws when embed is enabled without trustedContent", () => {
    expect(() =>
      validateFileSystemContentOptions({ contentDir: "./content", embed: true })
    ).toThrow(/`embed` requires `trustedContent: true`/);
  });

  it("accepts embed with trustedContent: true", () => {
    expect(() =>
      validateFileSystemContentOptions({
        contentDir: "./content",
        trustedContent: true,
        embed: true
      })
    ).not.toThrow();
  });
});
