import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Absolute path to the collection plugin source directory. */
const PLUGIN_DIR = fileURLToPath(new URL("../../", import.meta.url));

/** Read one collection plugin source file (top-level, excluding __tests__). */
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

describe("collection plugin — build-time gates", () => {
  it("isolates node:* behind the lazy writer.ts (no static node import elsewhere)", () => {
    for (const file of SOURCE_FILES) {
      if (file === "writer.ts") continue; // writer.ts is the node-only writer (allowed)
      expect(
        hasStaticNodeImport(readSource(file)),
        `${file} must not statically import node:*`
      ).toBe(false);
    }
  });

  it("reaches the node-only writer only via a lazy dynamic import in api.ts", () => {
    const api = readSource("api.ts");
    // No STATIC import of ./writer (would defeat the node-free read-side bundle)...
    const hasStaticWriterImport = api
      .split("\n")
      .some(line => line.trimStart().startsWith("import") && line.includes('"./writer"'));
    expect(hasStaticWriterImport).toBe(false);
    // ...only a lazy dynamic import.
    expect(api.includes('await import("./writer")')).toBe(true);
  });

  it("keeps the standalone reader (read.ts) node-free — it uses fetch, not node:fs", () => {
    expect(hasStaticNodeImport(readSource("read.ts"))).toBe(false);
    expect(readSource("read.ts").includes("await fetch(")).toBe(true);
  });
});
