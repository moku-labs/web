/**
 * @file build plugin — bundle phase END-TO-END splitting gate. Runs under `bun test`
 * (NOT vitest), so the REAL `Bun.build` backs the phase's default runner — the
 * closest-to-production proof that local dynamic imports become separate lazy
 * chunks instead of being inlined into the main client bundle.
 *
 * Regression scenario (observed in a deployed site's client bundle): `Bun.build`
 * defaults to `splitting: false`, which INLINES local dynamic imports — (1) the spa
 * plugin's lazy render module (Preact `render`, documented as "split into its own
 * chunk fetched only when a route's client DATA render runs") shipped in every main
 * bundle, and (2) the data plugin's node-only writer — whose dynamic
 * `import("node:fs/promises")` exists precisely so a browser bundle never pulls
 * `node:*` — was inlined too, with the node built-in silently shimmed. This suite
 * builds a fixture mirroring that shape through the real bundle phase and asserts
 * the entry chunk contains neither, while the lazy code still ships as on-demand
 * split chunks.
 *
 * Why a separate `bun test` file: the phase's default runner resolves
 * `globalThis.Bun` lazily and vitest workers have no `Bun` global (the unit suite
 * injects a fake runner instead). vitest only globs `__tests__/unit|integration`,
 * so this `e2e` file is invisible to it; run it with `bun run test:build-e2e`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundle } from "../../phases/bundle";
import type { Config, State } from "../../types";

/** Marker that exists ONLY in the lazily imported render fixture module. */
const RENDER_SENTINEL = "E2E_RENDER_SENTINEL_1b7c";
/** Marker that exists ONLY in the lazily imported node-writer fixture module. */
const WRITER_SENTINEL = "E2E_WRITER_SENTINEL_1b7c";

/** The temp fixture project root (removed in afterAll). */
let projectDir: string;
/** The built main entry chunk's source. */
let entryCode: string;
/** Every non-entry emitted JS chunk's source. */
let chunkCodes: string[];
/** The js asset manifest the bundle phase recorded for the pages phase. */
let manifest: Record<string, string>;

/**
 * Write the fixture client source tree: an entry that lazily imports a render
 * module (mirroring spa/render.ts) and a writer module that reaches
 * `node:fs/promises` only through a dynamic import (mirroring data/writer.ts).
 *
 * @param clientDir - The fixture's client source directory.
 */
function writeFixtureSources(clientDir: string): void {
  writeFileSync(
    path.join(clientDir, "render.ts"),
    `export function lazyRender(): string {\n  return "${RENDER_SENTINEL}";\n}\n`
  );
  writeFileSync(
    path.join(clientDir, "writer.ts"),
    [
      "export async function writeData(file: string): Promise<string> {",
      '  const { writeFile } = await import("node:fs/promises");',
      `  await writeFile(file, "${WRITER_SENTINEL}");`,
      `  return "${WRITER_SENTINEL}";`,
      "}",
      ""
    ].join("\n")
  );
  writeFileSync(
    path.join(clientDir, "main.ts"),
    [
      "export async function boot(): Promise<string> {",
      '  const { lazyRender } = await import("./render");',
      "  return lazyRender();",
      "}",
      "",
      "export async function persist(file: string): Promise<string> {",
      '  const { writeData } = await import("./writer");',
      "  return writeData(file);",
      "}",
      ""
    ].join("\n")
  );
}

beforeAll(async () => {
  projectDir = mkdtempSync(path.join(tmpdir(), "moku-bundle-split-"));
  const clientDir = path.join(projectDir, "src", "client");
  mkdirSync(clientDir, { recursive: true });
  writeFixtureSources(clientDir);

  const outDir = path.join(projectDir, "dist");
  const config: Config = {
    outDir,
    minify: true,
    feeds: false,
    sitemap: false,
    images: false,
    ogImage: false
  };
  const state: State = {
    config,
    // eslint-disable-next-line unicorn/no-null -- State.manifest is `RouteDefinition[] | null`
    manifest: null,
    buildCache: new Map<string, unknown>(),
    runId: "e2e-bundle-splitting",
    ogImageHashCache: new Map<string, string>(),
    renderCache: new Map()
  };
  const log = { info() {}, debug() {}, warn() {}, error() {} };

  // Run the REAL bundle phase (no runner injection → the actual Bun.build).
  await bundle(
    { state, config, log },
    { cssEntrypoints: [], jsEntrypoints: [path.join(clientDir, "main.ts")] }
  );

  manifest = state.buildCache.get("js") as Record<string, string>;
  const assetsDir = path.join(outDir, "assets");
  const jsFiles = readdirSync(assetsDir).filter(file => file.endsWith(".js"));
  entryCode = readFileSync(path.join(assetsDir, "main.js"), "utf8");
  chunkCodes = jsFiles
    .filter(file => file !== "main.js")
    .map(file => readFileSync(path.join(assetsDir, file), "utf8"));
});

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("build/phases/bundle — e2e code splitting (real Bun.build)", () => {
  test("each local dynamic import is emitted as its own split chunk", () => {
    expect(chunkCodes.length).toBeGreaterThanOrEqual(2);
    // The lazy render code ships — in exactly one chunk, not the entry.
    expect(chunkCodes.filter(code => code.includes(RENDER_SENTINEL)).length).toBe(1);
    // The node writer code ships — in exactly one chunk, not the entry.
    expect(chunkCodes.filter(code => code.includes(WRITER_SENTINEL)).length).toBe(1);
  });

  test("the main bundle inlines neither the lazy render module nor the node writer", () => {
    expect(entryCode).not.toContain(RENDER_SENTINEL);
    expect(entryCode).not.toContain(WRITER_SENTINEL);
    // The dynamic imports survive as on-demand chunk fetches.
    expect(entryCode).toContain("import(");
  });

  test("no node:* specifier (or shim of one) reaches the main bundle", () => {
    expect(entryCode).not.toContain("node:");
    // node:fs stays behind the dynamic boundary, inside the writer chunk only.
    const chunksWithNodeFs = chunkCodes.filter(code => code.includes("node:fs"));
    expect(chunksWithNodeFs.length).toBe(1);
    expect(chunksWithNodeFs[0]).toContain(WRITER_SENTINEL);
  });

  test("only the entry is recorded for <script> injection — chunks stay lazy", () => {
    expect(manifest).toEqual({ "main.js": "assets/main.js" });
  });
});
