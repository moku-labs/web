import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "src/plugins/**/__tests__/unit/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "integration",
          include: [
            "tests/integration/**/*.test.ts",
            "src/plugins/**/__tests__/integration/**/*.test.ts"
          ]
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
    // Shiki's first highlight loads its WASM engine + grammars + theme, which can
    // exceed the 5s default on a cold CI runner (the content/build tests hit this).
    // Give that one-time warmup headroom; warm runs finish in well under a second.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: ["src/**/types.ts", "src/**/types/**", "src/**/__tests__/**"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 }
    }
  }
});
