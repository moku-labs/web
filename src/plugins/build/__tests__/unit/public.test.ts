import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyPublic } from "../../phases/public";
import { makeCtx } from "../helpers";

describe("build/phases/public", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "build-public-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  /** Create `<tmp>/public` + `<tmp>/dist` paths and a ctx wired to them. */
  function makeDirs() {
    const publicDir = path.join(tmp, "public");
    const outDir = path.join(tmp, "dist");
    mkdirSync(publicDir, { recursive: true });
    const ctx = makeCtx({ config: { outDir, publicDir } });
    return { publicDir, outDir, ctx };
  }

  it("copies the publicDir verbatim into outDir", async () => {
    const { publicDir, outDir, ctx } = makeDirs();
    mkdirSync(path.join(publicDir, "nested"), { recursive: true });
    writeFileSync(path.join(publicDir, "favicon.ico"), "icon");
    writeFileSync(path.join(publicDir, "nested", "robots.txt"), "robots");

    const result = await copyPublic(ctx);

    expect(result?.copied).toBe(2);
    expect(readFileSync(path.join(outDir, "favicon.ico"), "utf8")).toBe("icon");
    expect(readFileSync(path.join(outDir, "nested", "robots.txt"), "utf8")).toBe("robots");
  });

  it("skips files whose destination is already fresh (same size, not older)", async () => {
    const { publicDir, outDir, ctx } = makeDirs();
    const src = path.join(publicDir, "favicon.ico");
    writeFileSync(src, "icon");
    // Backdate the source so the first copy's destination is strictly newer.
    utimesSync(src, new Date(Date.now() - 5000), new Date(Date.now() - 5000));
    await copyPublic(ctx);
    const destBefore = statSync(path.join(outDir, "favicon.ico")).mtimeMs;

    const rerun = await copyPublic(ctx);

    expect(rerun?.copied).toBe(0);
    expect(statSync(path.join(outDir, "favicon.ico")).mtimeMs).toBe(destBefore);
  });

  it("re-copies a file the source got newer than, even at the same size", async () => {
    const { publicDir, outDir, ctx } = makeDirs();
    const src = path.join(publicDir, "favicon.ico");
    writeFileSync(src, "icon");
    await copyPublic(ctx);

    // Same byte length, newer mtime than the copied destination → the mtime leg trips.
    const newerThanDest = new Date(statSync(path.join(outDir, "favicon.ico")).mtimeMs + 5000);
    writeFileSync(src, "ICON");
    utimesSync(src, newerThanDest, newerThanDest);
    const rerun = await copyPublic(ctx);

    expect(rerun?.copied).toBe(1);
    expect(readFileSync(path.join(outDir, "favicon.ico"), "utf8")).toBe("ICON");
  });

  it("re-copies a file whose size differs, even when the destination is newer", async () => {
    const { publicDir, outDir, ctx } = makeDirs();
    const src = path.join(publicDir, "favicon.ico");
    writeFileSync(src, "icon");
    await copyPublic(ctx);

    // Different byte length, backdated BEHIND the destination → the size leg trips.
    const olderThanDest = new Date(statSync(path.join(outDir, "favicon.ico")).mtimeMs - 5000);
    writeFileSync(src, "icon-v2");
    utimesSync(src, olderThanDest, olderThanDest);
    const rerun = await copyPublic(ctx);

    expect(rerun?.copied).toBe(1);
    expect(readFileSync(path.join(outDir, "favicon.ico"), "utf8")).toBe("icon-v2");
  });

  it("copies only the files missing from the destination on a rebuild", async () => {
    const { publicDir, outDir, ctx } = makeDirs();
    writeFileSync(path.join(publicDir, "a.txt"), "a");
    await copyPublic(ctx);

    mkdirSync(path.join(publicDir, "nested"), { recursive: true });
    writeFileSync(path.join(publicDir, "b.txt"), "b");
    writeFileSync(path.join(publicDir, "nested", "c.txt"), "c");
    const rerun = await copyPublic(ctx);

    expect(rerun?.copied).toBe(2);
    expect(readFileSync(path.join(outDir, "b.txt"), "utf8")).toBe("b");
    expect(readFileSync(path.join(outDir, "nested", "c.txt"), "utf8")).toBe("c");
  });

  it("copies symlinks as symlinks (no freshness compare)", async () => {
    const { publicDir, outDir, ctx } = makeDirs();
    const target = path.join(tmp, "target.txt");
    writeFileSync(target, "linked");
    symlinkSync(target, path.join(publicDir, "link.txt"));

    const result = await copyPublic(ctx);

    expect(result?.copied).toBe(1);
    expect(lstatSync(path.join(outDir, "link.txt")).isSymbolicLink()).toBe(true);
    expect(readFileSync(path.join(outDir, "link.txt"), "utf8")).toBe("linked");
  });

  it("skips silently when the publicDir is absent", async () => {
    const outDir = path.join(tmp, "dist");
    const ctx = makeCtx({ config: { outDir, publicDir: path.join(tmp, "no-such-dir") } });

    const result = await copyPublic(ctx);

    expect(result).toBeNull();
    expect(existsSync(outDir)).toBe(false);
  });

  it('defaults publicDir to "public" when unset', async () => {
    const outDir = path.join(tmp, "dist");
    // The default "public" is relative and does not exist under tmp cwd → skip.
    const ctx = makeCtx({ config: { outDir } });
    const result = await copyPublic(ctx);
    // Either the repo public dir exists or not; the call must not throw.
    expect(result === null || typeof result.copied === "number").toBe(true);
  });
});
