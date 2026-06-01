import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Absolute path to the data plugin source directory. */
const PLUGIN_DIR = fileURLToPath(new URL("../../", import.meta.url));

/** Read one data plugin source file (top-level, excluding __tests__). */
function readSource(file: string): string {
  return readFileSync(`${PLUGIN_DIR}${file}`, "utf8");
}

/** Every top-level `.ts` source file in the plugin (no tests). */
const SOURCE_FILES = readdirSync(PLUGIN_DIR).filter(
  name => name.endsWith(".ts") && !name.endsWith(".test.ts")
);

/** True if any line is a static `import ... "node:..."` statement (string-only check). */
function hasStaticNodeImport(src: string): boolean {
  return src.split("\n").some(line => {
    const trimmed = line.trimStart();
    return (
      trimmed.startsWith("import") && (trimmed.includes('"node:') || trimmed.includes("'node:"))
    );
  });
}

describe("data plugin — build-time gates", () => {
  it("isolates node:* behind the lazy emit.ts (no static node import outside emit.ts)", () => {
    for (const file of SOURCE_FILES) {
      if (file === "emit.ts") continue; // emit.ts is the node-only writer (allowed)
      expect(
        hasStaticNodeImport(readSource(file)),
        `${file} must not statically import node:*`
      ).toBe(false);
    }
  });

  it("reaches the node-only writer only via a lazy dynamic import in api.ts", () => {
    const api = readSource("api.ts");
    // No STATIC import of ./emit (would defeat the node-free read-side bundle)...
    const hasStaticEmitImport = api
      .split("\n")
      .some(line => line.trimStart().startsWith("import") && line.includes('"./emit"'));
    expect(hasStaticEmitImport).toBe(false);
    // ...only a lazy dynamic import.
    expect(api.includes('await import("./emit")')).toBe(true);
  });

  it("draft-safety lint-ban: never calls content's per-slug loader in the plugin", () => {
    for (const file of SOURCE_FILES) {
      const src = readSource(file);
      expect(src.includes("content.load("), `${file} must not call content.load(`).toBe(false);
      expect(
        src.includes("contentPlugin).load("),
        `${file} must not call require(contentPlugin).load(`
      ).toBe(false);
    }
  });
});
