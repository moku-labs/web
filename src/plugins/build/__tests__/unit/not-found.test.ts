import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateNotFound } from "../../phases/not-found";
import { makeCtx } from "../helpers";

describe("build/phases/not-found", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "build-404-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("is a no-op when notFound is false/unset", async () => {
    const ctx = makeCtx({ config: { outDir: tmp } });
    expect(await generateNotFound(ctx)).toBeNull();
  });

  it("emits a default 404.html when notFound is true", async () => {
    const ctx = makeCtx({ config: { outDir: tmp, notFound: true } });
    const result = await generateNotFound(ctx);
    expect(result?.path).toBe(path.join(tmp, "404.html"));
    const html = readFileSync(path.join(tmp, "404.html"), "utf8");
    expect(html).toContain("404");
    expect(html.toLowerCase()).toContain("<!doctype html>");
  });

  it("emits the configured body content when notFound.body is set", async () => {
    const ctx = makeCtx({
      config: { outDir: tmp, notFound: { body: "<h1>Custom Missing</h1>" } }
    });
    await generateNotFound(ctx);
    const html = readFileSync(path.join(tmp, "404.html"), "utf8");
    expect(html).toContain("Custom Missing");
  });

  it("writes the file at notFound.path verbatim (no shell wrap) when set", async () => {
    const page = path.join(tmp, "src-404.html");
    const full =
      '<!doctype html><html lang="en"><head><title>Gone</title></head><body><main>Lost</main></body></html>';
    writeFileSync(page, full, "utf8");
    const ctx = makeCtx({ config: { outDir: tmp, notFound: { path: page } } });
    const result = await generateNotFound(ctx);
    expect(result?.path).toBe(path.join(tmp, "404.html"));
    // Byte-for-byte: the app owns the whole document, no minimal shell is added.
    expect(readFileSync(path.join(tmp, "404.html"), "utf8")).toBe(full);
  });

  it("prefers notFound.path over notFound.body when both are set", async () => {
    const page = path.join(tmp, "src-404.html");
    writeFileSync(page, "<p>from path</p>", "utf8");
    const ctx = makeCtx({
      config: { outDir: tmp, notFound: { path: page, body: "<p>from body</p>" } }
    });
    await generateNotFound(ctx);
    const html = readFileSync(path.join(tmp, "404.html"), "utf8");
    expect(html).toContain("from path");
    expect(html).not.toContain("from body");
  });

  it("throws a clear error when notFound.path cannot be read", async () => {
    const ctx = makeCtx({
      config: { outDir: tmp, notFound: { path: path.join(tmp, "does-not-exist.html") } }
    });
    await expect(generateNotFound(ctx)).rejects.toThrow(/could not read notFound\.path/);
  });

  it("substitutes the asset placeholders in a notFound.path page (bundle names are fingerprinted)", async () => {
    // A standalone 404 page cannot hardcode "/assets/main.css" anymore — the
    // bundle filename embeds a content hash. The placeholders are its way in.
    const page = path.join(tmp, "src-404.html");
    writeFileSync(
      page,
      "<html><head><!--moku:assets:css--></head><body><!--moku:assets:js--><!--moku:assets--></body></html>",
      "utf8"
    );
    const ctx = makeCtx({ config: { outDir: tmp, notFound: { path: page } } });
    ctx.state.buildCache.set("css", { "main.css": "assets/main-abc123.css" });
    ctx.state.buildCache.set("js", { "spa.js": "assets/spa-def456.js" });

    await generateNotFound(ctx);

    const html = readFileSync(path.join(tmp, "404.html"), "utf8");
    expect(html).toContain('<head><link rel="stylesheet" href="/assets/main-abc123.css"></head>');
    expect(html).toContain('<script type="module" src="/assets/spa-def456.js"></script>');
    // The combined placeholder carries both kinds.
    expect(html).toContain(
      '<link rel="stylesheet" href="/assets/main-abc123.css"><script type="module" src="/assets/spa-def456.js"></script></body>'
    );
    expect(html).not.toContain("moku:assets");
  });
});
