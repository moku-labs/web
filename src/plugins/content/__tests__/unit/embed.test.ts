import type { Html, Root as MdastRoot } from "mdast";
import { h } from "preact";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { describe, expect, it } from "vitest";
import { embedPlugin } from "../../pipeline/embed";
import { EmbedFacadeButton } from "../../pipeline/embed-facade";
import type { EmbedFacadeProps } from "../../types";
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

/** Run the embed transform (optionally with custom options) and return the html node values. */
function transform(md: string, options?: Parameters<typeof embedPlugin>[0]): string[] {
  const tree = parse(md);
  embedPlugin(options)(tree);
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

    expect(html).toContain('<figure class="lazy-embed" data-island="lazy-embed"');
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

  it("accepts a co-located relative src (kept raw — the provider resolves it per slug)", () => {
    for (const src of ["./game/index.html", "../shared/game/", "game/index.html"]) {
      const [html] = transform(`::embed{src="${src}" title="Local"}`);
      expect(html).toContain(`data-embed-src="${src}"`);
    }
  });

  it("reserves the box with data-embed-width/height + inline aspect-ratio when both are given", () => {
    const [html] = transform(
      '::embed{src="https://g.dev/" title="Portrait" width="400" height="711"}'
    );

    expect(html).toContain('data-embed-width="400"');
    expect(html).toContain('data-embed-height="711"');
    expect(html).toContain('style="aspect-ratio: 400 / 711; max-width: 400px;"');
  });

  it("omits sizing attributes when no width/height is given", () => {
    const [html] = transform('::embed{src="https://g.dev/" title="No size"}');

    expect(html).not.toContain("data-embed-width");
    expect(html).not.toContain("aspect-ratio");
    expect(html).not.toContain("style=");
  });

  it("fails the build when only one of width/height is given", () => {
    expect(() => transform('::embed{src="https://g.dev/" title="x" width="400"}')).toThrow(
      /width and height must be set together/
    );
    expect(() => transform('::embed{src="https://g.dev/" title="x" height="711"}')).toThrow(
      /width and height must be set together/
    );
  });

  it("fails the build on non-positive-integer dimensions", () => {
    for (const [w, h] of [
      ["400", "0"],
      ["abc", "711"],
      ["400.5", "711"],
      ["-4", "711"]
    ]) {
      expect(() =>
        transform(`::embed{src="https://g.dev/" title="x" width="${w}" height="${h}"}`)
      ).toThrow(/must be positive integers in pixels/);
    }
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
        /must be an http\(s\) URL, a root-relative path, or a co-located relative path/
      );
    }
  });

  it("uses the [web] error prefix", () => {
    expect(() => transform('::embed{title="No Src"}')).toThrow(/^\[web\]/);
  });
});

/** A custom facade reading props + a custom directive attribute (`poster`). */
const posterFacade = (props: EmbedFacadeProps) =>
  h(
    "button",
    { type: "button", class: "lazy-embed-button", "data-poster": props.attributes.poster },
    h("span", { class: "lazy-embed-title" }, `${props.title} ${props.width}x${props.height}`)
  );

/** A facade delegating to the exported default (drift guard). */
const delegatingFacade = (props: EmbedFacadeProps) => EmbedFacadeButton(props);

describe("content/pipeline/embed — custom facade component", () => {
  it("renders a consumer facade with the embed props, inside the framework figure", () => {
    const [html] = transform(
      '::embed{src="https://g.dev/" title="Game" width="400" height="711" poster="/p.jpg"}',
      { facade: posterFacade }
    );

    // Consumer-controlled inner content (custom attribute + props interpolation):
    expect(html).toContain('data-poster="/p.jpg"');
    expect(html).toContain("Game 400x711");
    // Framework still owns the figure wrapper, island hooks, and reserved-box sizing:
    expect(html).toContain('<figure class="lazy-embed" data-island="lazy-embed"');
    expect(html).toContain('data-embed-src="https://g.dev/"');
    expect(html).toContain('style="aspect-ratio: 400 / 711; max-width: 400px;"');
  });

  it("the exported EmbedFacadeButton matches the default facade markup (drift guard)", () => {
    const [explicit] = transform('::embed{src="https://g.dev/" title="My Game"}', {
      facade: delegatingFacade
    });
    const [byDefault] = transform('::embed{src="https://g.dev/" title="My Game"}');

    expect(explicit).toBe(byDefault);
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
