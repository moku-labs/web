/**
 * @file build plugin — bundle phase END-TO-END `build.env` constants gate. Runs under `bun test` (NOT vitest), so
 * the REAL `Bun.build` backs the phase's default runner.
 *
 * Scenario: an app keeps developer-only code (cheats) behind a build-time flag,
 * `if (process.env.IS_DEVELOPMENT) void import("./cheats")`, plus a spread of cheat actions, and names the flag in
 * `build.env`. With the flag unset in the build process and `minify` on, the production bundle must contain neither
 * the branch's code nor its lazy chunk; with `IS_DEVELOPMENT=true` both must ship.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundle } from "../../phases/bundle";
import type { Config, State } from "../../types";

/** Marker that exists ONLY in the lazily imported cheats module. */
const CHUNK_SENTINEL = "E2E_CHEAT_CHUNK_5d2e";
/** Marker that exists ONLY in the guarded inline branch. */
const INLINE_SENTINEL = "E2E_CHEAT_INLINE_5d2e";

/** The temp fixture project root (removed in afterAll). */
let projectDir: string;

/**
 * Write the fixture client sources: an entry with a guarded dynamic import and a guarded spread.
 *
 * @param clientDir - The fixture's client source directory.
 */
function writeFixtureSources(clientDir: string): void {
  writeFileSync(
    path.join(clientDir, "cheats.ts"),
    `export function cheat(): string {\n  return "${CHUNK_SENTINEL}";\n}\n`
  );
  writeFileSync(
    path.join(clientDir, "main.ts"),
    [
      "export const actions = {",
      "  play: () => 1,",
      `  ...(process.env.IS_DEVELOPMENT ? { reset: () => "${INLINE_SENTINEL}" } : {})`,
      "};",
      "if (import.meta.env.IS_DEVELOPMENT) {",
      '  void import("./cheats").then(module => module.cheat());',
      "}",
      ""
    ].join("\n")
  );
}

/**
 * Bundle the fixture with the flag set or unset in the build process, and read every emitted JS file.
 *
 * @param value - `IS_DEVELOPMENT` in the build process; `""` leaves it unset.
 * @returns The concatenated source of every emitted JS file, and how many files there are.
 */
async function buildWith(value: string): Promise<{ code: string; files: number }> {
  const clientDir = path.join(projectDir, "src", "client");
  const outDir = path.join(projectDir, `dist-${value || "prod"}`);
  const config: Config = {
    outDir,
    minify: true,
    feeds: false,
    sitemap: false,
    images: false,
    ogImage: false,
    env: ["IS_DEVELOPMENT"]
  };
  const state: State = {
    config,
    // eslint-disable-next-line unicorn/no-null -- State.manifest is `RouteDefinition[] | null`
    manifest: null,
    buildCache: new Map<string, unknown>(),
    runId: `e2e-bundle-define-${value || "prod"}`,
    ogImageHashCache: new Map<string, string>(),
    renderCache: new Map()
  };
  const log = { info() {}, debug() {}, warn() {}, error() {} };
  // The flag comes from the build process's environment, as `IS_DEVELOPMENT=true bun run build` sets it.
  if (value) process.env.IS_DEVELOPMENT = value;
  else delete process.env.IS_DEVELOPMENT;
  try {
    await bundle(
      { state, config, log },
      { cssEntrypoints: [], jsEntrypoints: [path.join(clientDir, "main.ts")] }
    );
  } finally {
    delete process.env.IS_DEVELOPMENT;
  }
  const assetsDir = path.join(outDir, "assets");
  const jsFiles = readdirSync(assetsDir).filter(file => file.endsWith(".js"));
  const code = jsFiles.map(file => readFileSync(path.join(assetsDir, file), "utf8")).join("\n");
  return { code, files: jsFiles.length };
}

let prod: { code: string; files: number };
let dev: { code: string; files: number };

beforeAll(async () => {
  projectDir = mkdtempSync(path.join(tmpdir(), "moku-bundle-define-"));
  mkdirSync(path.join(projectDir, "src", "client"), { recursive: true });
  writeFixtureSources(path.join(projectDir, "src", "client"));
  prod = await buildWith("");
  dev = await buildWith("true");
});

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("build/phases/bundle — e2e build.env constants (real Bun.build)", () => {
  test("an unset flag drops the guarded branch and its lazy chunk", () => {
    expect(prod.code).not.toContain(CHUNK_SENTINEL);
    expect(prod.code).not.toContain(INLINE_SENTINEL);
    expect(prod.code).not.toContain("import(");
    expect(prod.files).toBe(1);
  });

  test("a set flag keeps both, the dynamic import still a separate chunk", () => {
    expect(dev.code).toContain(CHUNK_SENTINEL);
    expect(dev.code).toContain(INLINE_SENTINEL);
    expect(dev.files).toBeGreaterThanOrEqual(2);
  });
});
