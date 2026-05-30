import { describe, it } from "vitest";

describe("content/pipeline/frontmatter", () => {
  it.todo("throws on missing required frontmatter fields");
  it.todo("coerces Date values to ISO YYYY-MM-DD strings");
  it.todo("applies defaults: draft=false, author=config.defaultAuthor");
  it.todo("does not mutate the gray-matter cache between calls");
});
