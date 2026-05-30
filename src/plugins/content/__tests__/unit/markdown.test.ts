import { describe, it } from "vitest";

describe("content/pipeline/markdown", () => {
  it.todo("renders headings, code blocks, and tables");
  it.todo("strips <script>/onerror/javascript: when trustedContent is false (sanitize LAST)");
  it.todo("passes the same XSS payload through when trustedContent is true");
  it.todo("preserves pull-quote/section-divider/loading=lazy via the extended schema");
  it.todo("concatenates extraRemarkPlugins/extraRehypePlugins, NOT replacing defaults");
});
