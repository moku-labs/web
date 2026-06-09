/**
 * Docs-freshness guards for the repo-level, npm-shipped documentation
 * (README.md, llms.txt, llms-full.txt).
 *
 * These files are hand-maintained and have drifted from src before (the
 * 2026-06-09 audit caught a pre-1.0 status line at v1.6.x and llms files
 * documenting the removed `router.set()` API). Each test pins a fact that
 * MUST hold against the current source so the drift cannot silently recur.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Resolved from `process.cwd()` (the repo root under vitest), matching the
// integration harness convention.
const read = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");

const readme = read("README.md");
const llms = read("llms.txt");
const llmsFull = read("llms-full.txt");
const llmsFiles = [
  ["llms.txt", llms],
  ["llms-full.txt", llmsFull]
] as const;

describe("README.md (ships in the npm tarball)", () => {
  it("does not claim a pre-1.0 status — the package is on the 1.x line", () => {
    expect(readme).not.toContain("pre-1.0");
    expect(readme).not.toContain("Status: `0.x`");
    expect(readme).toContain("Status: `1.x`");
  });

  it("does not claim the router needs the global URLPattern (dropped in v1.4.1)", () => {
    expect(readme).not.toMatch(/router uses the global/);
  });
});

describe.each(llmsFiles)("%s", (_name, text) => {
  it("does not document the removed imperative router.set() registration API", () => {
    // The API was removed in `refactor(router)!: remove the imperative router.set() API`.
    // Mentions must only survive as "was removed" notes, never as a documented call.
    expect(text).not.toContain("app.router.set(");
    expect(text).not.toMatch(/`set\(routes\)`/);
  });

  it("does not claim the router requires the global URLPattern (native-RegExp matcher since v1.4.1)", () => {
    expect(text).not.toMatch(/uses the global `?URLPattern`?/);
  });

  it("documents the bare default-locale URL behavior (v1.6.0)", () => {
    expect(text).toMatch(/default locale is served (at )?bare/i);
    expect(text).toContain("createUrls(routes, defaultLocale?)");
  });

  it("documents the post-2026-06-05 build/head features (notFound.path, ogImage.defaultCard, head.siteHead)", () => {
    expect(text).toContain("notFound");
    expect(text).toContain("{ path }");
    expect(text).toContain("defaultCard");
    expect(text).toContain("siteHead");
  });
});

describe("llms-full.txt budget claims", () => {
  it("matches the CI browser-bundle budget in scripts/verify-browser-bundle.ts", () => {
    const script = read("scripts/verify-browser-bundle.ts");
    const budgetMatch = script.match(/SIZE_BUDGET_BYTES = (\d+) \* 1024/);
    expect(budgetMatch).not.toBeNull();
    const budgetKb = Number(budgetMatch?.[1]);
    expect(llmsFull).toContain(`under the ${budgetKb} kB gz budget`);
  });
});
