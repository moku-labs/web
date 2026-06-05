import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../../pipeline/frontmatter";
import type { FileSystemContentOptions } from "../../types";

const baseOptions: FileSystemContentOptions = {
  contentDir: "./src/content",
  trustedContent: false,
  extraRemarkPlugins: [],
  extraRehypePlugins: [],
  shikiTheme: "github-dark"
};

const valid = [
  "---",
  "title: Hello",
  "date: 2026-01-15",
  "description: An intro",
  "tags: [a, b]",
  "language: en",
  "---",
  "",
  "# Body"
].join("\n");

describe("content/pipeline/frontmatter", () => {
  it("throws on missing required frontmatter fields", () => {
    const raw = ["---", "title: Hello", "---", "body"].join("\n");
    expect(() => parseFrontmatter(raw, baseOptions)).toThrow(/\[web\] content/);
    expect(() => parseFrontmatter(raw, baseOptions)).toThrow(/date/);
  });

  it("coerces Date values to ISO YYYY-MM-DD strings", () => {
    // Bare YAML date is parsed to a Date by js-yaml; must be coerced back.
    const { frontmatter } = parseFrontmatter(valid, baseOptions);
    expect(frontmatter.date).toBe("2026-01-15");
    expect(typeof frontmatter.date).toBe("string");
  });

  it("applies defaults: draft=false, author=defaultAuthor", () => {
    const { frontmatter } = parseFrontmatter(valid, { ...baseOptions, defaultAuthor: "Alex" });
    expect(frontmatter.draft).toBe(false);
    expect(frontmatter.author).toBe("Alex");
  });

  it("keeps author undefined when no defaultAuthor is configured", () => {
    const { frontmatter } = parseFrontmatter(valid, baseOptions);
    expect(frontmatter.author).toBeUndefined();
  });

  it("does not mutate the gray-matter cache between calls", () => {
    const first = parseFrontmatter(valid, { ...baseOptions, defaultAuthor: "One" });
    const second = parseFrontmatter(valid, baseOptions);
    // The first call's defaultAuthor must not leak into the second parse.
    expect(first.frontmatter.author).toBe("One");
    expect(second.frontmatter.author).toBeUndefined();
  });

  it("returns the body separated from frontmatter", () => {
    const { body } = parseFrontmatter(valid, baseOptions);
    expect(body.trim()).toBe("# Body");
  });
});
