/* eslint-disable sonarjs/no-clear-text-protocols -- local preview server URLs are intentionally http. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApi } from "../../api";
import { createPreviewHandler, runPreviewServer } from "../../preview";
import type { ServeStaticOptions } from "../../types";
import { makeCtx } from "../helpers";

describe("cli/createPreviewHandler", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "cli-preview-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("serves a resolved file via state.fileResponse", async () => {
    writeFileSync(path.join(tmp, "index.html"), "<h1>home</h1>", "utf8");
    const fileResponse = vi.fn((file: string) => new Response(`served:${file}`));
    const { ctx } = makeCtx({ config: { outDir: tmp }, state: { fileResponse } });

    const handler = createPreviewHandler(ctx);
    const response = handler(new Request("http://localhost/"));
    expect(await response.text()).toBe(`served:${path.join(tmp, "index.html")}`);
    expect(fileResponse).toHaveBeenCalledWith(path.join(tmp, "index.html"), 200);
  });

  it("returns 404 plain text when nothing resolves (not even a 404.html)", () => {
    const { ctx } = makeCtx({ config: { outDir: tmp } });
    const handler = createPreviewHandler(ctx);
    const response = handler(new Request("http://localhost/missing"));
    expect(response.status).toBe(404);
  });

  it("serves the nearest 404.html with status 404", async () => {
    writeFileSync(path.join(tmp, "404.html"), "<h1>nope</h1>", "utf8");
    const fileResponse = vi.fn((_file: string, status: number) => new Response("x", { status }));
    const { ctx } = makeCtx({ config: { outDir: tmp }, state: { fileResponse } });
    const handler = createPreviewHandler(ctx);
    const response = handler(new Request("http://localhost/whatever"));
    expect(response.status).toBe(404);
    expect(fileResponse).toHaveBeenCalledWith(path.join(tmp, "404.html"), 404);
  });

  it("resolves a clean subdirectory URL to its index.html", async () => {
    mkdirSync(path.join(tmp, "about"), { recursive: true });
    writeFileSync(path.join(tmp, "about", "index.html"), "<h1>about</h1>", "utf8");
    const { ctx } = makeCtx({ config: { outDir: tmp } });
    const handler = createPreviewHandler(ctx);
    const response = handler(new Request("http://localhost/about"));
    expect(await response.text()).toContain(path.join(tmp, "about", "index.html"));
  });
});

describe("cli/runPreviewServer", () => {
  it("starts the server, renders serverReady, and stops on SIGINT", async () => {
    const stop = vi.fn();
    let captured: ServeStaticOptions | undefined;
    const serveStatic = vi.fn((options: ServeStaticOptions) => {
      captured = options;
      return { stop };
    });
    const { ctx, render } = makeCtx({
      config: { outDir: "dist", port: 5000 },
      state: { serveStatic, networkUrl: () => "http://192.168.1.9:5000" }
    });

    const previewPromise = createApi(ctx).preview();
    expect(serveStatic).toHaveBeenCalledTimes(1);
    expect(captured?.port).toBe(5000);

    const calls = (render as ReturnType<typeof makeCtx>["render"] & { calls: unknown[][] }).calls;
    const ready = calls.find(call => call[0] === "serverReady");
    expect(ready?.[1]).toMatchObject({
      local: "http://localhost:5000",
      network: "http://192.168.1.9:5000"
    });

    process.emit("SIGINT");
    await previewPromise;
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("the started server's fetch handler resolves clean URLs", async () => {
    let captured: ServeStaticOptions | undefined;
    const serveStatic = vi.fn((options: ServeStaticOptions) => {
      captured = options;
      return {
        stop() {
          // no-op
        }
      };
    });
    const { ctx } = makeCtx({ config: { outDir: "dist" }, state: { serveStatic } });
    const previewPromise = runPreviewServer(ctx, 4173);
    // The handler returns 404 for a guaranteed miss (no real dist/).
    const response = await captured?.fetch(new Request("http://localhost/nope-not-here"));
    expect(response?.status).toBe(404);
    process.emit("SIGINT");
    await previewPromise;
  });
});
