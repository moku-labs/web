/**
 * @file Guards the toolchain wiring that no other test exercises: every quality gate
 * must actually be pointed at the files it claims to cover. Each of these regressed
 * silently before — a `test:cli-e2e` script no CI step ever ran, a coverage include
 * (`src/**∕*.ts`) whose anchored glob skipped the .tsx build phases, and a `scripts/`
 * directory neither biome nor eslint looked at.
 *
 * Paths resolve from `process.cwd()` (the repo root under vitest), matching the
 * integration harness convention.
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import vitestConfig from "../../vitest.config";

const ROOT = process.cwd();

/** Reads a repo file as UTF-8, resolved from the repo root. */
const readRepoFile = (relativePath: string): string =>
  readFileSync(path.resolve(ROOT, relativePath), "utf8");

/** Globs repo-root-relative patterns the same anchored way vitest/biome do. */
const globRepo = (patterns: string[]): Set<string> => new Set(globSync(patterns, { cwd: ROOT }));

describe("toolchain wiring", () => {
  describe("cli e2e suite (bun test, invisible to vitest)", () => {
    it("package.json still defines test:cli-e2e pointing at an existing bun-test suite", () => {
      const packageJson = JSON.parse(readRepoFile("package.json")) as {
        scripts: Record<string, string>;
      };
      const script = packageJson.scripts["test:cli-e2e"];

      expect(script).toBeDefined();
      expect(script).toContain("bun test");

      // The directory the script targets must exist and contain at least one test.
      const target = script?.split(" ").at(-1) ?? "";
      expect(globRepo([`${target.replace(/\/$/, "")}/**/*.test.ts`]).size).toBeGreaterThan(0);
    });

    it("CI runs the cli e2e suite (vitest never globs it, so CI must invoke it explicitly)", () => {
      const ci = readRepoFile(".github/workflows/ci.yml");

      expect(ci).toContain("bun run test:cli-e2e");
    });
  });

  describe("coverage include", () => {
    it("covers every .tsx source file, not just .ts (anchored-glob check)", () => {
      const coverage = vitestConfig.test?.coverage;
      const include = coverage && "include" in coverage ? (coverage.include ?? []) : [];

      expect(include.length).toBeGreaterThan(0);

      // Discover all non-test .tsx sources (the build phase renderers live here)
      // and assert each one is matched by the coverage include patterns using the
      // same ANCHORED globbing vitest uses to pick up untested files.
      const tsxSources = [...globRepo(["src/**/*.tsx"])].filter(
        file => !file.includes("__tests__")
      );
      const covered = globRepo([...include]);

      expect(tsxSources.length).toBeGreaterThan(0);
      for (const file of tsxSources) {
        expect(covered, `${file} must be covered by coverage.include`).toContain(file);
      }
    });
  });

  describe("lint coverage of scripts/", () => {
    const scriptFiles = [...globRepo(["scripts/**/*.ts"])];

    it("scripts/ contains the tooling this suite guards", () => {
      expect(scriptFiles).toContain("scripts/verify-browser-bundle.ts");
    });

    it("biome's files.includes covers every file in scripts/", () => {
      const biome = JSON.parse(readRepoFile("biome.json")) as {
        files: { includes: string[] };
      };
      const covered = globRepo(biome.files.includes);

      for (const file of scriptFiles) {
        expect(covered, `${file} must be covered by biome files.includes`).toContain(file);
      }
    });

    it("eslint resolves a real (non-ignored) config with rules for every scripts/ file", async () => {
      const eslint = new ESLint({ cwd: ROOT });

      for (const file of scriptFiles) {
        expect(await eslint.isPathIgnored(file), `${file} must not be eslint-ignored`).toBe(false);

        // A file matched by NO config block gets no rules at all ("no matching
        // configuration was supplied") — assert real rules actually apply.
        const config = (await eslint.calculateConfigForFile(file)) as {
          rules?: Record<string, unknown>;
        } | null;
        expect(Object.keys(config?.rules ?? {}).length).toBeGreaterThan(0);
      }
    });
  });
});
