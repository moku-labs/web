import { describe, expect, it } from "vitest";
import { fileSystemContent } from "../../providers";
import type { FileSystemContentOptions } from "../../types";

const CONTENT_DIR = "./src/content";

/**
 * Render one fenced block through a new provider (a new app's own processor).
 *
 * @param language - The fence's language.
 * @param shikiLanguages - The provider's grammar list, unset when omitted.
 * @returns The rendered HTML.
 * @example
 * ```ts
 * const html = await renderFence("ts", ["ts"]);
 * ```
 */
async function renderFence(
  language: string,
  shikiLanguages?: FileSystemContentOptions["shikiLanguages"]
): Promise<string> {
  const options = shikiLanguages
    ? { contentDir: CONTENT_DIR, shikiLanguages }
    : { contentDir: CONTENT_DIR };
  return fileSystemContent(options).render(`\`\`\`${language}\nconst x = 1;\n\`\`\``);
}

// Shiki keeps one highlighter per process and it only grows. These tests run in
// order on the one this file gets: the lists come first, because a provider with
// no list loads every grammar.
describe("content/pipeline/markdown shikiLanguages", () => {
  it("loads only the listed grammars", async () => {
    expect(await renderFence("ts", ["ts"])).toContain("shiki");
    // A second app: Shiki registered `ts` as `typescript`, so this load resolves the alias.
    expect(await renderFence("python", ["ts"])).not.toContain("shiki");
  });

  it("loads every bundled grammar when the setting is unset", async () => {
    expect(await renderFence("rust")).toContain("shiki");
  });
});
