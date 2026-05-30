import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApi, validateConfig } from "../../api";
import { PHASE_ORDER } from "../../pipeline";
import { makeCtx } from "../helpers";

describe("build/api", () => {
  it("phases() returns the static order (a fresh copy each call)", () => {
    const ctx = makeCtx({});
    const api = createApi(ctx);
    expect(api.phases()).toEqual([...PHASE_ORDER]);
    expect(api.phases()).not.toBe(api.phases());
  });

  describe("run({ outDir }) override", () => {
    let tmp: string;
    beforeEach(() => {
      tmp = mkdtempSync(path.join(tmpdir(), "build-api-"));
    });
    afterEach(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    it("is honored — writes to the override dir and resets per-run state", async () => {
      const override = path.join(tmp, "preview");
      const ctx = makeCtx({
        config: { outDir: path.join(tmp, "default"), feeds: false, sitemap: false },
        requireMap: {
          router: { manifest: () => [] },
          i18n: { locales: () => ["en"], defaultLocale: () => "en" },
          content: { loadAll: async () => new Map() },
          head: { render: () => "" },
          site: {
            url: () => "https://x.dev",
            name: () => "X",
            description: () => "",
            author: () => "",
            canonical: (p: string) => `https://x.dev${p}`
          }
        }
      });
      ctx.state.runId = "stale";
      const api = createApi(ctx);
      const result = await api.run({ outDir: override });
      expect(result.outDir).toBe(override);
      expect(existsSync(override)).toBe(true);
      // Per-run reset replaced the stale runId.
      expect(ctx.state.runId).not.toBe("stale");
    });
  });

  it("validateConfig throws actionable [web] build.outDir on empty outDir", () => {
    expect(() =>
      validateConfig({
        outDir: "",
        minify: true,
        feeds: true,
        sitemap: true,
        images: true,
        ogImage: false
      })
    ).toThrowError(/\[web\] build\.outDir/);
  });

  it("validateConfig throws when ogImage enabled but fontDir has no fonts", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "build-fonts-"));
    try {
      // Directory exists but has no font files.
      writeFileSync(path.join(dir, "note.txt"), "not a font");
      expect(() =>
        validateConfig({
          outDir: "./dist",
          minify: true,
          feeds: true,
          sitemap: true,
          images: true,
          ogImage: { fontDir: dir }
        })
      ).toThrowError(/\[web\] build\.ogImage/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validateConfig throws when ogImage fontDir is missing entirely", () => {
    expect(() =>
      validateConfig({
        outDir: "./dist",
        minify: true,
        feeds: true,
        sitemap: true,
        images: true,
        ogImage: { fontDir: "/no/such/font/dir/xyz" }
      })
    ).toThrowError(/\[web\] build\.ogImage/);
  });
});
