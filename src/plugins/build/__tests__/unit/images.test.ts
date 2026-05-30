import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { processImages } from "../../phases/images";
import { makeCtx } from "../helpers";

describe("build/phases/images", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "build-images-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("copies images from source dirs into outDir/assets when config.images is true", async () => {
    const source = path.join(tmp, "public");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "logo.png"), "PNGDATA");
    const outDir = path.join(tmp, "dist");
    const ctx = makeCtx({ config: { outDir, images: true } });

    const copied = await processImages(ctx, { sourceDirectories: [source] });

    expect(copied).toBe(1);
    expect(existsSync(path.join(outDir, "assets", "logo.png"))).toBe(true);
  });

  it("is a no-op when config.images is false", async () => {
    const source = path.join(tmp, "public");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "logo.png"), "PNGDATA");
    const outDir = path.join(tmp, "dist");
    const ctx = makeCtx({ config: { outDir, images: false } });

    const copied = await processImages(ctx, { sourceDirectories: [source] });

    expect(copied).toBe(0);
    expect(existsSync(path.join(outDir, "assets"))).toBe(false);
  });
});
