import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentPlugin } from "../../../content";
import { copyContentImages } from "../../phases/content-images";
import { makeCtx } from "../helpers";

/** Build a requireMap that stubs the content API the phase pulls (`contentDir()`). */
function deps(contentDir: string): Record<string, unknown> {
  return { [contentPlugin.name]: { contentDir: () => contentDir } };
}

/** Seed `<contentDir>/<slug>/images/<file>` with `data`. */
function seedImage(contentDir: string, slug: string, file: string, data: string): void {
  mkdirSync(path.join(contentDir, slug, "images"), { recursive: true });
  writeFileSync(path.join(contentDir, slug, "images", file), data);
}

/** Seed `<contentDir>/<slug>/<dir>/<file>` (any co-located asset dir) with `data`. */
function seedAsset(
  contentDir: string,
  slug: string,
  dir: string,
  file: string,
  data: string
): void {
  mkdirSync(path.join(contentDir, slug, dir), { recursive: true });
  writeFileSync(path.join(contentDir, slug, dir, file), data);
}

describe("build/phases/content-images", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "build-content-images-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("copies each article's images/ dir to a single shared <slug>/images/ dir", async () => {
    const contentDir = path.join(tmp, "content");
    seedImage(contentDir, "ball-factory", "bf-1.webp", "WEBP");
    const outDir = path.join(tmp, "dist");
    const ctx = makeCtx({ config: { outDir, images: true }, requireMap: deps(contentDir) });

    const copied = await copyContentImages(ctx);

    expect(copied).toBe(1);
    expect(readFileSync(path.join(outDir, "ball-factory", "images", "bf-1.webp"), "utf8")).toBe(
      "WEBP"
    );
  });

  it("no-ops (returns 0) when the content plugin is NOT composed, even with images enabled", async () => {
    // images enabled but no `content` in requireMap → ctx.has("content") false → no require throw.
    const ctx = makeCtx({
      config: { outDir: path.join(tmp, "dist"), images: true },
      requireMap: {}
    });

    expect(await copyContentImages(ctx)).toBe(0);
  });

  it("copies nested subdirectories under images/ recursively", async () => {
    const contentDir = path.join(tmp, "content");
    seedImage(contentDir, "ball-factory", "bf-1.webp", "TOP");
    mkdirSync(path.join(contentDir, "ball-factory", "images", "ru", "deep"), { recursive: true });
    writeFileSync(path.join(contentDir, "ball-factory", "images", "ru", "deep", "b.webp"), "DEEP");
    const outDir = path.join(tmp, "dist");
    const ctx = makeCtx({ config: { outDir, images: true }, requireMap: deps(contentDir) });

    const copied = await copyContentImages(ctx);

    expect(copied).toBe(1); // one article images/ dir, copied recursively
    expect(readFileSync(path.join(outDir, "ball-factory", "images", "bf-1.webp"), "utf8")).toBe(
      "TOP"
    );
    expect(
      readFileSync(path.join(outDir, "ball-factory", "images", "ru", "deep", "b.webp"), "utf8")
    ).toBe("DEEP");
  });

  it("copies any co-located asset dir, not just images/ (e.g. a pre-built game/ embed bundle)", async () => {
    const contentDir = path.join(tmp, "content");
    seedImage(contentDir, "screw-master", "cover.webp", "IMG");
    seedAsset(contentDir, "screw-master", "game", "index.html", "<html>GAME</html>");
    seedAsset(contentDir, "screw-master", "game", "bundle.js", "JS");
    const outDir = path.join(tmp, "dist");
    const ctx = makeCtx({ config: { outDir, images: true }, requireMap: deps(contentDir) });

    const copied = await copyContentImages(ctx);

    expect(copied).toBe(1); // one article, multiple asset dirs → counted once
    expect(readFileSync(path.join(outDir, "screw-master", "images", "cover.webp"), "utf8")).toBe(
      "IMG"
    );
    expect(readFileSync(path.join(outDir, "screw-master", "game", "index.html"), "utf8")).toBe(
      "<html>GAME</html>"
    );
    expect(readFileSync(path.join(outDir, "screw-master", "game", "bundle.js"), "utf8")).toBe("JS");
  });

  it("skips dot- and underscore-prefixed asset dirs (treated as private)", async () => {
    const contentDir = path.join(tmp, "content");
    seedAsset(contentDir, "post", "game", "index.html", "PUBLIC");
    seedAsset(contentDir, "post", "_drafts", "secret.txt", "PRIVATE");
    seedAsset(contentDir, "post", ".cache", "junk", "JUNK");
    const outDir = path.join(tmp, "dist");
    const ctx = makeCtx({ config: { outDir, images: true }, requireMap: deps(contentDir) });

    const copied = await copyContentImages(ctx);

    expect(copied).toBe(1);
    expect(existsSync(path.join(outDir, "post", "game", "index.html"))).toBe(true);
    expect(existsSync(path.join(outDir, "post", "_drafts"))).toBe(false);
    expect(existsSync(path.join(outDir, "post", ".cache"))).toBe(false);
  });

  it("skips article directories without any asset subdir", async () => {
    const contentDir = path.join(tmp, "content");
    mkdirSync(path.join(contentDir, "no-images"), { recursive: true });
    writeFileSync(path.join(contentDir, "no-images", "en.md"), "# hi");
    const outDir = path.join(tmp, "dist");
    const ctx = makeCtx({ config: { outDir, images: true }, requireMap: deps(contentDir) });

    const copied = await copyContentImages(ctx);

    expect(copied).toBe(0);
    expect(existsSync(path.join(outDir, "no-images"))).toBe(false);
  });

  it("is a no-op when config.images is false", async () => {
    const contentDir = path.join(tmp, "content");
    seedImage(contentDir, "ball-factory", "bf-1.webp", "WEBP");
    const outDir = path.join(tmp, "dist");
    const ctx = makeCtx({ config: { outDir, images: false }, requireMap: deps(contentDir) });

    const copied = await copyContentImages(ctx);

    expect(copied).toBe(0);
    expect(existsSync(outDir)).toBe(false);
  });

  it("is a no-op when the content directory does not exist", async () => {
    const outDir = path.join(tmp, "dist");
    const ctx = makeCtx({
      config: { outDir, images: true },
      requireMap: deps(path.join(tmp, "missing"))
    });

    const copied = await copyContentImages(ctx);

    expect(copied).toBe(0);
  });
});
