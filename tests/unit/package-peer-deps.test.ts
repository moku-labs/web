/**
 * @file Package-shape guard — preact must be a PEER dependency, never a regular one.
 *
 * `preact` is externalized in dist (the published `dist/index.mjs` imports it as a
 * bare specifier) and consumers compile their own JSX against preact too. If this
 * package shipped its own nested `preact` under `dependencies`, a consumer-installed
 * second instance would break hooks and island hydration — the classic dual-instance
 * footgun. The same applies to `preact-render-to-string`, which is also externalized
 * and itself peers on preact: as a regular dependency it could resolve a nested
 * preact copy distinct from the consumer's. These tests pin the contract:
 * peerDependencies (caret range) + matching exact pins in devDependencies for the
 * local build/tests.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PEER_PACKAGES = ["preact", "preact-render-to-string"] as const;

interface PackageJson {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const packageJson: PackageJson = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf8")
);

/** True when an exact `version` pin satisfies a caret `range` (e.g. `^10.29.2`). */
function satisfiesCaret(range: string, version: string): boolean {
  if (!range.startsWith("^")) return false;

  const [rMajor = 0, rMinor = 0, rPatch = 0] = range.slice(1).split(".").map(Number);
  const [vMajor = 0, vMinor = 0, vPatch = 0] = version.split(".").map(Number);

  if (vMajor !== rMajor) return false;
  if (vMinor !== rMinor) return vMinor > rMinor;
  return vPatch >= rPatch;
}

describe("package.json: preact dual-instance guard", () => {
  it.each(PEER_PACKAGES)("declares %s under peerDependencies with a caret range", name => {
    const range = packageJson.peerDependencies?.[name];

    expect(range, `${name} must be a peer dependency`).toBeDefined();
    expect(range).toMatch(/^\^\d+\.\d+\.\d+$/);
  });

  it.each(PEER_PACKAGES)("does NOT declare %s under dependencies (no nested copy)", name => {
    expect(packageJson.dependencies?.[name]).toBeUndefined();
  });

  it.each(PEER_PACKAGES)("pins a devDependency copy of %s that satisfies the peer range", name => {
    const range = packageJson.peerDependencies?.[name] ?? "";
    const devPin = packageJson.devDependencies?.[name];

    expect(devPin, `${name} must stay in devDependencies for local build/tests`).toBeDefined();
    expect(devPin).toMatch(/^\d+\.\d+\.\d+$/);
    expect(satisfiesCaret(range, devPin ?? "")).toBe(true);
  });

  it("keeps preact peer majors aligned (preact ^10 ↔ render-to-string ^6)", () => {
    // preact-render-to-string 6.x peers on preact 10.x. If either major moves,
    // this test forces a deliberate re-check of the pairing.
    expect(packageJson.peerDependencies?.preact).toMatch(/^\^10\./);
    expect(packageJson.peerDependencies?.["preact-render-to-string"]).toMatch(/^\^6\./);
  });
});
