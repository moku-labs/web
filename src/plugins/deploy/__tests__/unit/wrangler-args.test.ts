import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildWranglerArgs } from "../../wrangler";

const ROOT = process.cwd();

describe("deploy/buildWranglerArgs", () => {
  it("assembles the correct argv array (no shell)", () => {
    const args = buildWranglerArgs({
      outDir: "dist",
      slug: "my-site",
      branch: "main",
      root: ROOT
    });
    expect(args).toEqual([
      "bunx",
      "wrangler",
      "pages",
      "deploy",
      "dist",
      "--project-name",
      "my-site",
      "--branch",
      "main"
    ]);
  });

  it("rejects branch '--config' with ERR_DEPLOY_INVALID_BRANCH", () => {
    expect(() =>
      buildWranglerArgs({ outDir: "dist", slug: "my-site", branch: "--config", root: ROOT })
    ).toThrowError(expect.objectContaining({ code: "ERR_DEPLOY_INVALID_BRANCH" }));
  });

  it("rejects branch '; rm' / spaces with ERR_DEPLOY_INVALID_BRANCH", () => {
    expect(() =>
      buildWranglerArgs({ outDir: "dist", slug: "my-site", branch: "; rm", root: ROOT })
    ).toThrowError(expect.objectContaining({ code: "ERR_DEPLOY_INVALID_BRANCH" }));
    expect(() =>
      buildWranglerArgs({ outDir: "dist", slug: "my-site", branch: "has space", root: ROOT })
    ).toThrowError(expect.objectContaining({ code: "ERR_DEPLOY_INVALID_BRANCH" }));
  });

  it("accepts a valid 'preview/landing' branch", () => {
    const args = buildWranglerArgs({
      outDir: "dist",
      slug: "my-site",
      branch: "preview/landing",
      root: ROOT
    });
    expect(args).toContain("preview/landing");
  });

  it("rejects an outDir resolving outside root with ERR_DEPLOY_PATH_TRAVERSAL", () => {
    expect(() =>
      buildWranglerArgs({ outDir: "../escape", slug: "my-site", branch: "main", root: ROOT })
    ).toThrowError(expect.objectContaining({ code: "ERR_DEPLOY_PATH_TRAVERSAL" }));
    // An absolute path outside root is also rejected.
    expect(() =>
      buildWranglerArgs({
        outDir: path.resolve(ROOT, "..", "elsewhere"),
        slug: "my-site",
        branch: "main",
        root: ROOT
      })
    ).toThrowError(expect.objectContaining({ code: "ERR_DEPLOY_PATH_TRAVERSAL" }));
  });
});
