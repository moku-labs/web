import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateCacheHeaders } from "../../phases/cache-headers";
import { makeCtx } from "../helpers";

/** Default immutable Cache-Control emitted for fingerprinted bundles. */
const IMMUTABLE = "public, max-age=31536000, immutable";
/** Default revalidation Cache-Control emitted for everything else. */
const REVALIDATE = "public, max-age=0, must-revalidate";

/** Seed the bundle phase's `<kind>:outputs` lists the phase reads. */
function seedOutputs(ctx: ReturnType<typeof makeCtx>, css: string[], js: string[]): void {
  ctx.state.buildCache.set("css:outputs", css);
  ctx.state.buildCache.set("js:outputs", js);
}

describe("build/phases/cache-headers", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "cache-headers-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("emits the catch-all revalidation rule FIRST, then a per-file immutable rule per bundle", async () => {
    const ctx = makeCtx({ config: { outDir: tmp, publicDir: path.join(tmp, "no-public") } });
    seedOutputs(ctx, ["assets/main-abc123.css"], ["assets/spa-def456.js"]);

    const result = await generateCacheHeaders(ctx);

    const content = await readFile(path.join(tmp, "_headers"), "utf8");
    expect(result).toEqual({ path: path.join(tmp, "_headers"), ruleCount: 3 });
    expect(content).toBe(
      `/*\n  Cache-Control: ${REVALIDATE}\n\n` +
        `/assets/main-abc123.css\n  ! Cache-Control\n  Cache-Control: ${IMMUTABLE}\n\n` +
        `/assets/spa-def456.js\n  ! Cache-Control\n  Cache-Control: ${IMMUTABLE}\n`
    );
  });

  it("detaches the catch-all Cache-Control in every per-file rule (Cloudflare comma-joins duplicates)", async () => {
    // Regression guard for the Cloudflare semantics that motivated the layout: a
    // request matches EVERY rule whose pattern fits and duplicate headers are
    // JOINED, not overridden — so without `! Cache-Control` a bundle would ship
    // with "max-age=0, …, max-age=31536000, immutable" glued together.
    const ctx = makeCtx({ config: { outDir: tmp, publicDir: path.join(tmp, "no-public") } });
    seedOutputs(ctx, [], ["assets/spa-def456.js"]);

    await generateCacheHeaders(ctx);

    const content = await readFile(path.join(tmp, "_headers"), "utf8");
    const perFile = content.split("\n\n")[1];
    expect(perFile).toContain("! Cache-Control");
    expect(perFile?.indexOf("! Cache-Control")).toBeLessThan(
      perFile?.indexOf(`Cache-Control: ${IMMUTABLE}`) ?? -1
    );
  });

  it("includes lazy split chunks (the complete output lists, not just the entry manifest)", async () => {
    const ctx = makeCtx({ config: { outDir: tmp, publicDir: path.join(tmp, "no-public") } });
    seedOutputs(ctx, ["assets/main-a.css"], ["assets/spa-b.js", "assets/chunk-c.js"]);

    const result = await generateCacheHeaders(ctx);

    const content = await readFile(path.join(tmp, "_headers"), "utf8");
    expect(result?.ruleCount).toBe(4);
    expect(content).toContain("/assets/chunk-c.js");
  });

  it("appends the app's <publicDir>/_headers SOURCE content AFTER the generated rules", async () => {
    // App rules last = the app can override a generated header (after `! …`).
    const publicDir = path.join(tmp, "public");
    await mkdir(publicDir, { recursive: true });
    await writeFile(path.join(publicDir, "_headers"), "/*\n  X-Frame-Options: DENY\n", "utf8");
    const ctx = makeCtx({ config: { outDir: tmp, publicDir } });
    seedOutputs(ctx, ["assets/main-a.css"], []);

    await generateCacheHeaders(ctx);

    const content = await readFile(path.join(tmp, "_headers"), "utf8");
    expect(content.indexOf("X-Frame-Options")).toBeGreaterThan(content.indexOf("Cache-Control"));
    expect(content.endsWith("/*\n  X-Frame-Options: DENY\n")).toBe(true);
  });

  it("honors configured Cache-Control overrides for both tiers", async () => {
    const ctx = makeCtx({
      config: {
        outDir: tmp,
        publicDir: path.join(tmp, "no-public"),
        cacheHeaders: { assets: "public, max-age=60", pages: "no-store" }
      }
    });
    seedOutputs(ctx, ["assets/main-a.css"], []);

    await generateCacheHeaders(ctx);

    const content = await readFile(path.join(tmp, "_headers"), "utf8");
    expect(content).toContain("Cache-Control: no-store");
    expect(content).toContain("Cache-Control: public, max-age=60");
    expect(content).not.toContain(IMMUTABLE);
  });

  it("still emits the catch-all rule when no bundles were produced", async () => {
    const ctx = makeCtx({ config: { outDir: tmp, publicDir: path.join(tmp, "no-public") } });

    const result = await generateCacheHeaders(ctx);

    const content = await readFile(path.join(tmp, "_headers"), "utf8");
    expect(result?.ruleCount).toBe(1);
    expect(content).toBe(`/*\n  Cache-Control: ${REVALIDATE}\n`);
  });

  it("warns when the generated rule count exceeds Cloudflare's 100-rule cap", async () => {
    const ctx = makeCtx({ config: { outDir: tmp, publicDir: path.join(tmp, "no-public") } });
    const many = Array.from({ length: 120 }, (_, index) => `assets/chunk-${index}.js`);
    seedOutputs(ctx, [], many);

    await generateCacheHeaders(ctx);

    expect(ctx.log.warn).toHaveBeenCalledWith("build:cache-headers", { rules: 121, limit: 100 });
  });
});
