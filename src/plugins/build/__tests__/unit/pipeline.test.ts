import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeCleanTarget, planIncrementalRebuild } from "../../pipeline";

describe("build/pipeline planIncrementalRebuild", () => {
  it("a full build (no/empty changed set) reuses nothing", () => {
    const expected = { contentChanged: [], contentReuse: false, renderReuse: false };
    expect(planIncrementalRebuild(undefined)).toEqual(expected);
    expect(planIncrementalRebuild([])).toEqual(expected);
  });

  it("a Markdown-only change reuses content + renders and lists the changed md", () => {
    const plan = planIncrementalRebuild(["content/intro/en.md", "content/about/en.md"]);
    expect(plan).toEqual({
      contentChanged: ["content/intro/en.md", "content/about/en.md"],
      contentReuse: true,
      renderReuse: true
    });
  });

  it("a CSS-only change reuses content + renders (no markdown to invalidate)", () => {
    expect(planIncrementalRebuild(["src/client/styles.css"])).toEqual({
      contentChanged: [],
      contentReuse: true,
      renderReuse: true
    });
  });

  it("a code change reuses content but busts the render cache (code can change any page)", () => {
    expect(planIncrementalRebuild(["src/components/Card.tsx", "content/intro/en.md"])).toEqual({
      contentChanged: ["content/intro/en.md"],
      contentReuse: true,
      renderReuse: false
    });
  });

  it("an unclassifiable change (a bare directory) forces a full rebuild — correctness over speed", () => {
    expect(planIncrementalRebuild(["content"])).toEqual({
      contentChanged: [],
      contentReuse: false,
      renderReuse: false
    });
  });
});

describe("build/pipeline assertSafeCleanTarget", () => {
  /** A synthetic project root OUTSIDE the OS temp area (pure path math — never touched). */
  const ROOT = path.join(path.sep, "srv", "example-site");

  it("rejects the filesystem root", () => {
    expect(() => assertSafeCleanTarget(path.sep, ROOT)).toThrow(/not a safe clean target/);
  });

  it('rejects "." and the project root itself (relative and absolute spellings)', () => {
    expect(() => assertSafeCleanTarget(".", ROOT)).toThrow(/not a safe clean target/);
    expect(() => assertSafeCleanTarget("./", ROOT)).toThrow(/not a safe clean target/);
    expect(() => assertSafeCleanTarget(ROOT, ROOT)).toThrow(/not a safe clean target/);
  });

  it('rejects a ".." escape and any ancestor of the project root', () => {
    expect(() => assertSafeCleanTarget("..", ROOT)).toThrow(/not a safe clean target/);
    expect(() => assertSafeCleanTarget("../sibling", ROOT)).toThrow(/not a safe clean target/);
    expect(() => assertSafeCleanTarget(path.dirname(ROOT), ROOT)).toThrow(
      /not a safe clean target/
    );
  });

  it("rejects the home directory, even when it sits inside the build's root", () => {
    // Configured directly (an absolute "~" expansion gone wrong) …
    expect(() => assertSafeCleanTarget(homedir(), ROOT)).toThrow(/not a safe clean target/);
    // … and even when the build runs from an ancestor of home, so home is "inside root".
    expect(() => assertSafeCleanTarget(homedir(), path.dirname(homedir()))).toThrow(
      /not a safe clean target/
    );
  });

  it("rejects an absolute path outside both the project root and the OS temp area", () => {
    expect(() => assertSafeCleanTarget(path.join(path.sep, "srv", "other-site"), ROOT)).toThrow(
      /not a safe clean target/
    );
  });

  it("rejects the OS temp directory itself (only paths strictly inside it are disposable)", () => {
    expect(() => assertSafeCleanTarget(tmpdir(), ROOT)).toThrow(/not a safe clean target/);
  });

  it("accepts a relative outDir inside the project root and returns it resolved", () => {
    expect(assertSafeCleanTarget("./dist", ROOT)).toBe(path.join(ROOT, "dist"));
    expect(assertSafeCleanTarget("out/site", ROOT)).toBe(path.join(ROOT, "out", "site"));
  });

  it("accepts an absolute outDir nested inside the project root", () => {
    const nested = path.join(ROOT, "dist");
    expect(assertSafeCleanTarget(nested, ROOT)).toBe(nested);
  });

  it("accepts an absolute outDir strictly inside the OS temp area (preview/test builds)", () => {
    const scratch = path.join(tmpdir(), "moku-preview", "dist");
    expect(assertSafeCleanTarget(scratch, ROOT)).toBe(scratch);
  });

  it("the error is actionable — it names the offender, the rule, and the fix", () => {
    expect(() => assertSafeCleanTarget(".", ROOT)).toThrow(
      /\[web\] build\.outDir:[\s\S]*force-deletes[\s\S]*inside the project/
    );
  });
});
