import { defineConfig } from "vitest/config";

// Shiki's first highlight loads its WASM engine + grammars + theme, which can
// exceed vitest's 5s default on a cold CI runner (the content/build tests hit
// this). Give that one-time warmup headroom; warm runs finish well under a second.
// NOTE: must be set per-project — root-level `test.*` options do NOT cascade into
// the `projects[]` configs (only true globals like `onConsoleLog`/`coverage` do).
const WARMUP_TIMEOUT = 30_000;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "src/plugins/**/__tests__/unit/**/*.test.ts"],
          testTimeout: WARMUP_TIMEOUT,
          hookTimeout: WARMUP_TIMEOUT
        }
      },
      {
        test: {
          name: "integration",
          include: [
            "tests/integration/**/*.test.ts",
            "src/plugins/**/__tests__/integration/**/*.test.ts"
          ],
          testTimeout: WARMUP_TIMEOUT,
          hookTimeout: WARMUP_TIMEOUT
        }
      }
    ],
    // The framework-level integration scenarios drive the REAL createApp, whose log
    // plugin ships in "production" mode (debug/info → console.log on stdout) and
    // cannot be silenced via consumer pluginConfigs. Suppress that stdout build
    // chatter so the suite output stays readable; keep stderr (warn/error) visible
    // so real problems still surface. (Unit/plugin tests use log "test" mode and
    // emit nothing here, so this is a no-op for them.)
    onConsoleLog(_log, type) {
      return type === "stderr";
    },
    coverage: {
      provider: "istanbul",
      // Must cover .tsx too: the build phase renderers (og-images.tsx, pages.tsx)
      // are source like any other. With a bare `*.ts` include, a .tsx file that no
      // test loads would never be globbed as "untested" and would silently escape
      // the coverage thresholds.
      include: ["src/**/*.{ts,tsx}"],
      // `src/testing.ts` is the devDep-only test harness — exercised transitively by
      // every island test, but a coverage gate on glue is low-value (mirrors types.ts).
      exclude: ["src/**/types.ts", "src/**/types/**", "src/**/__tests__/**", "src/testing.ts"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 }
    }
  }
});
