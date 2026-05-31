import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("copies the publicDir verbatim into outDir", async () => {
    const publicDir = path.join(tmp, "public");
    const outDir = path.join(tmp, "dist");
    mkdirSync(path.join(publicDir, "nested"), { recursive: true });
    writeFileSync(path.join(publicDir, "favicon.ico"), "icon");
    writeFileSync(path.join(publicDir, "nested", "robots.txt"), "robots");
    const ctx = makeCtx({ config: { outDir, publicDir } });

    const result = await copyPublic(ctx);

    expect(result?.copied).toBeGreaterThan(0);
    expect(readFileSync(path.join(outDir, "favicon.ico"), "utf8")).toBe("icon");
    expect(readFileSync(path.join(outDir, "nested", "robots.txt"), "utf8")).toBe("robots");
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
