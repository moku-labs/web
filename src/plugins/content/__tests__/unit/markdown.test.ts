import type { Root as HastRoot } from "hast";
import { describe, expect, it } from "vitest";
import { ensureProcessor } from "../../pipeline/markdown";
import { createContentState } from "../../state";
import type { Config } from "../../types";

const baseConfig: Config = {
  contentDir: "./src/content",
  trustedContent: false,
  extraRemarkPlugins: [],
  extraRehypePlugins: [],
  shikiTheme: "github-dark"
};

/** Render markdown through a freshly-built processor for the given config. */
async function render(md: string, config: Config = baseConfig): Promise<string> {
  const state = createContentState({ global: {}, config });
  const processor = ensureProcessor(state, config);
  return String(await processor.process(md));
}

describe("content/pipeline/markdown", () => {
  it("renders headings, code blocks, and tables", async () => {
    const html = await render(
      [
        "# Title",
        "",
        "| a | b |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "```ts",
        "const x = 1;",
        "```"
      ].join("\n")
    );
    expect(html).toContain("<h1");
    expect(html).toContain("Title");
    expect(html).toContain("<table");
    // Shiki wraps code in <pre class="shiki"> ... <code>.
    expect(html).toContain("shiki");
    expect(html).toContain("<code");
  });

  it("accepts a custom Shiki theme OBJECT (not just a bundled name)", async () => {
    const customTheme = {
      name: "test-warm",
      type: "dark" as const,
      colors: { "editor.background": "#181412", "editor.foreground": "#d4c8b8" },
      tokenColors: [{ scope: ["keyword", "storage.type"], settings: { foreground: "#f97316" } }]
    };
    const html = await render("```ts\nconst x = 1;\n```", {
      ...baseConfig,
      shikiTheme: customTheme
    });
    // The custom theme renders to a <pre class="shiki test-warm"> with its bg + the
    // keyword color inline — proving the object flows through to @shikijs/rehype.
    expect(html).toContain("test-warm");
    expect(html).toContain("#181412");
    expect(html.toLowerCase()).toContain("#f97316");
  });

  it("types shikiTheme as the BundledTheme union (editor autocomplete) + a theme object", () => {
    // Bundled names are the typed, autocompleted set (assigned to the literal type, not
    // widened to `string`); a ThemeRegistration object is also accepted. Note: arbitrary
    // strings still type-check via ThemeRegistrationAny's all-optional object arm — same as
    // Shiki's own `StringLiteralUnion<BundledTheme>` — so this documents autocomplete, not
    // typo-rejection.
    const byName: Config["shikiTheme"] = "dracula";
    const byObject: Config["shikiTheme"] = {
      name: "warm",
      type: "dark",
      settings: [{ scope: "keyword", settings: { foreground: "#f97316" } }]
    };
    expect(byName).toBe("dracula");
    expect(byObject).toMatchObject({ name: "warm" });
  });

  it("strips <script>/onerror/javascript: when trustedContent is false (sanitize LAST)", async () => {
    const md = [
      "<script>alert(1)</script>",
      "",
      '<img src="x" onerror="alert(2)">',
      "",
      "[click](javascript:alert(3))"
    ].join("\n");
    const html = await render(md, { ...baseConfig, trustedContent: false });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("passes the same XSS payload through when trustedContent is true", async () => {
    const md = "<script>alert(1)</script>";
    const html = await render(md, { ...baseConfig, trustedContent: true });
    expect(html).toContain("<script>alert(1)</script>");
  });

  it("preserves pull-quote/section-divider/loading=lazy via the extended schema", async () => {
    const md = [
      ":::pullquote",
      "An important aside.",
      ":::",
      "",
      "![alt](pic.png)",
      "",
      "---"
    ].join("\n");
    const html = await render(md, { ...baseConfig, trustedContent: false });
    expect(html).toContain('class="pull-quote"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('class="section-divider"');
    expect(html).toContain("section-divider-ornament");
  });

  it("concatenates extraRemarkPlugins/extraRehypePlugins, NOT replacing defaults", async () => {
    const flags = { remarkRan: false, rehypeRan: false };
    /** Marker remark plugin that flips a flag when run. */
    function markerRemark() {
      // eslint-disable-next-line unicorn/consistent-function-scoping -- test marker captures `flags`
      return (_tree: HastRoot) => {
        flags.remarkRan = true;
      };
    }
    /** Marker rehype plugin that flips a flag when run. */
    function markerRehype() {
      // eslint-disable-next-line unicorn/consistent-function-scoping -- test marker captures `flags`
      return (_tree: HastRoot) => {
        flags.rehypeRan = true;
      };
    }
    const html = await render("# Still Works", {
      ...baseConfig,
      extraRemarkPlugins: [markerRemark],
      extraRehypePlugins: [markerRehype]
    });
    // The extras ran...
    expect(flags.remarkRan).toBe(true);
    expect(flags.rehypeRan).toBe(true);
    // ...AND the framework default (heading rendering) still produced output.
    expect(html).toContain("<h1");
    expect(html).toContain("Still Works");
  });
});
