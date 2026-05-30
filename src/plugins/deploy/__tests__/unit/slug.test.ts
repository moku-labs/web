import { describe, it } from "vitest";

describe("deploy/toSlug", () => {
  it.todo("produces a Cloudflare project-name regex-compliant slug");
  it.todo("handles a leading digit/hyphen");
  it.todo("handles all-symbol input");
  it.todo("truncates over-length names to <= 58 chars");
  it.todo("collapses unicode/whitespace");
});
