import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveFileLimit, runPreflight } from "../../preflight";
import type { Config } from "../../types";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    target: "cloudflare-pages",
    outDir: "dist",
    productionBranch: "main",
    scrubAllowlist: [],
    compatibilityDate: "2024-01-01",
    ci: false,
    ...overrides
  };
}

describe("deploy/runPreflight", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "deploy-preflight-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function seedWrangler(): void {
    writeFileSync(path.join(root, "wrangler.jsonc"), "{}\n", "utf8");
  }
  function seedFiles(count: number): void {
    mkdirSync(path.join(root, "dist"), { recursive: true });
    for (let i = 0; i < count; i++) {
      writeFileSync(path.join(root, "dist", `f${i}.txt`), "x", "utf8");
    }
  }

  it("throws ERR_DEPLOY_NO_WRANGLER_CONFIG when wrangler.jsonc is missing", async () => {
    seedFiles(1);
    await expect(runPreflight(makeConfig(), root)).rejects.toMatchObject({
      code: "ERR_DEPLOY_NO_WRANGLER_CONFIG"
    });
  });

  it("throws ERR_DEPLOY_EMPTY_OUTDIR when outDir is missing", async () => {
    seedWrangler();
    await expect(runPreflight(makeConfig(), root)).rejects.toMatchObject({
      code: "ERR_DEPLOY_EMPTY_OUTDIR"
    });
  });

  it("throws ERR_DEPLOY_EMPTY_OUTDIR when outDir exists but is empty", async () => {
    seedWrangler();
    mkdirSync(path.join(root, "dist"), { recursive: true });
    await expect(runPreflight(makeConfig(), root)).rejects.toMatchObject({
      code: "ERR_DEPLOY_EMPTY_OUTDIR"
    });
  });

  it("allows a file count exactly at the limit and blocks one over", async () => {
    seedWrangler();
    seedFiles(3);
    // Limit 3 -> exactly at limit passes.
    await expect(
      runPreflight(makeConfig(), root, { MOKU_DEPLOY_MAX_FILES: "3" })
    ).resolves.toBeUndefined();
    // Limit 2 -> 3 files is one over.
    await expect(
      runPreflight(makeConfig(), root, { MOKU_DEPLOY_MAX_FILES: "2" })
    ).rejects.toMatchObject({ code: "ERR_DEPLOY_TOO_MANY_FILES" });
  });

  it("honors the MOKU_DEPLOY_MAX_FILES env override", async () => {
    seedWrangler();
    seedFiles(5);
    await expect(
      runPreflight(makeConfig(), root, { MOKU_DEPLOY_MAX_FILES: "10" })
    ).resolves.toBeUndefined();
  });

  it("walks nested directories when counting files", async () => {
    seedWrangler();
    mkdirSync(path.join(root, "dist", "a", "b"), { recursive: true });
    writeFileSync(path.join(root, "dist", "top.txt"), "x", "utf8");
    writeFileSync(path.join(root, "dist", "a", "mid.txt"), "x", "utf8");
    writeFileSync(path.join(root, "dist", "a", "b", "deep.txt"), "x", "utf8");
    // 3 nested files, limit 3 -> passes.
    await expect(
      runPreflight(makeConfig(), root, { MOKU_DEPLOY_MAX_FILES: "3" })
    ).resolves.toBeUndefined();
  });

  it("accepts an absolute outDir inside the project", async () => {
    seedWrangler();
    seedFiles(1);
    const abs = path.join(root, "dist");
    await expect(runPreflight(makeConfig({ outDir: abs }), root)).resolves.toBeUndefined();
  });

  it("detects an oversized file with ERR_DEPLOY_FILE_TOO_LARGE", async () => {
    seedWrangler();
    mkdirSync(path.join(root, "dist"), { recursive: true });
    // 26 MiB > 25 MiB cap.
    const big = Buffer.alloc(26 * 1024 * 1024, 0);
    writeFileSync(path.join(root, "dist", "huge.bin"), big);
    await expect(runPreflight(makeConfig(), root)).rejects.toMatchObject({
      code: "ERR_DEPLOY_FILE_TOO_LARGE"
    });
  });
});

describe("deploy/resolveFileLimit", () => {
  it("defaults to the free-tier limit of 20000", () => {
    expect(resolveFileLimit({})).toBe(20_000);
  });

  it("uses a valid override, capped at the paid-tier 100000", () => {
    expect(resolveFileLimit({ MOKU_DEPLOY_MAX_FILES: "50000" })).toBe(50_000);
    expect(resolveFileLimit({ MOKU_DEPLOY_MAX_FILES: "999999" })).toBe(100_000);
  });

  it("falls back to the free-tier limit on a garbled override", () => {
    expect(resolveFileLimit({ MOKU_DEPLOY_MAX_FILES: "abc" })).toBe(20_000);
    expect(resolveFileLimit({ MOKU_DEPLOY_MAX_FILES: "-5" })).toBe(20_000);
    expect(resolveFileLimit({ MOKU_DEPLOY_MAX_FILES: "" })).toBe(20_000);
  });
});
