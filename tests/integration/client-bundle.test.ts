/* eslint-disable sonarjs/no-os-command-from-path, sonarjs/publicly-writable-directories -- build-probe test: invokes the project's `bun` bundler (CI PATH) and writes a throwaway bundle to the OS temp dir, cleaned up in afterAll. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

/** Throwaway output path for the probe bundle. */
const OUT = "/tmp/moku-web-client-browser-probe.js";

/**
 * Acceptance guard for the `@moku-labs/web/client` entry: a browser-targeted
 * bundle must succeed AND contain none of the Node/SSG graph. If a module the
 * client transitively imports ever pulls `node:*`/satori/resvg/shiki/etc., this
 * fails — the regression that originally broke consumer SPA builds.
 */
describe("@moku-labs/web/client browser bundle purity", () => {
  afterAll(() => {
    if (existsSync(OUT)) rmSync(OUT);
  });

  it("bundles src/client.ts for the browser with no Node/SSG dependencies", () => {
    // Throws (failing the test) if bun cannot produce a browser bundle.
    execFileSync("bun", ["build", "src/client.ts", "--target=browser", `--outfile=${OUT}`], {
      stdio: "pipe"
    });
    expect(existsSync(OUT)).toBe(true);

    const bundle = readFileSync(OUT, "utf8");
    const forbidden =
      /satori|@resvg\/resvg-js|\bresvg\b|@shikijs|\bshiki\b|node:[a-z/]+|gray-matter|preact-render-to-string/;
    expect(bundle).not.toMatch(forbidden);
  });
});
