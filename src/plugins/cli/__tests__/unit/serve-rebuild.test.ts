import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApi } from "../../api";
import {
  createDevHandler,
  createRebuilder,
  createReloadHub,
  injectReloadClient,
  RELOAD_PATH
} from "../../serve";
import type { BuildSummary, ReloadInfo, WatchHandle } from "../../types";
import { makeCtx } from "../helpers";

describe("cli/createRebuilder (debounced rebuild)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces a burst of changes into a single rebuild and reports the reload", async () => {
    const summary: BuildSummary = { outDir: "dist", pageCount: 4, durationMs: 7 };
    const runBuild = vi.fn(async () => summary);
    const reloads: ReloadInfo[] = [];
    const rebuilder = createRebuilder({
      debounceMs: 150,
      runBuild,
      onReloaded: info => reloads.push(info),
      onError: () => undefined
    });

    // Three rapid changes within the debounce window → one rebuild.
    rebuilder.schedule("a.md");
    rebuilder.schedule("b.md");
    rebuilder.schedule("c.md");
    expect(runBuild).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);

    expect(runBuild).toHaveBeenCalledTimes(1);
    expect(reloads).toHaveLength(1);
    // The last changed file in the window wins.
    expect(reloads[0]).toEqual({ file: "c.md", pageCount: 4, durationMs: 7 });
  });

  it("routes a rebuild failure to onError (loop keeps running)", async () => {
    const runBuild = vi.fn(async () => {
      throw new Error("boom");
    });
    const onError = vi.fn();
    const rebuilder = createRebuilder({
      debounceMs: 10,
      runBuild,
      onReloaded: () => undefined,
      onError
    });
    rebuilder.schedule("x.md");
    await vi.advanceTimersByTimeAsync(10);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("cancel() prevents a pending rebuild from firing", async () => {
    const runBuild = vi.fn(async () => ({ outDir: "dist", pageCount: 1, durationMs: 1 }));
    const rebuilder = createRebuilder({
      debounceMs: 50,
      runBuild,
      onReloaded: () => undefined,
      onError: () => undefined
    });
    rebuilder.schedule("x.md");
    rebuilder.cancel();
    await vi.advanceTimersByTimeAsync(50);
    expect(runBuild).not.toHaveBeenCalled();
  });
});

describe("cli/createReloadHub (SSE live reload)", () => {
  it("tracks connected clients and pushes a reload frame to each", async () => {
    const hub = createReloadHub();
    expect(hub.size()).toBe(0);
    const response = hub.connect();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(hub.size()).toBe(1);

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    // First chunk is the open comment.
    await reader.read();
    hub.reloadAll();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: reload");
    await reader.cancel();
  });
});

describe("cli/injectReloadClient", () => {
  it("injects the SSE client before </body>", () => {
    const html = injectReloadClient("<html><body><h1>hi</h1></body></html>");
    expect(html).toContain("EventSource");
    expect(html.indexOf("EventSource")).toBeLessThan(html.indexOf("</body>"));
  });

  it("appends the client when there is no </body>", () => {
    const html = injectReloadClient("<h1>hi</h1>");
    expect(html.endsWith("</script>")).toBe(true);
    expect(html.startsWith("<h1>hi</h1>")).toBe(true);
  });
});

describe("cli/createDevHandler", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "cli-dev-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("serves the SSE stream at the reload path", async () => {
    const { ctx } = makeCtx();
    const hub = createReloadHub();
    const handler = createDevHandler(ctx, hub);
    const response = await handler(new Request(`http://localhost${RELOAD_PATH}`));
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(hub.size()).toBe(1);
  });

  it("injects the reload client into HTML responses when liveReload is on", async () => {
    writeFileSync(path.join(tmp, "index.html"), "<html><body>page</body></html>", "utf8");
    const fileResponse = vi.fn((file: string) => new Response(readFileSync(file, "utf8")));
    const { ctx } = makeCtx({ config: { outDir: tmp, liveReload: true }, state: { fileResponse } });
    const handler = createDevHandler(ctx, createReloadHub());
    const response = await handler(new Request("http://localhost/"));
    const html = await response.text();
    expect(html).toContain("EventSource");
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("does NOT inject the client when liveReload is off", async () => {
    writeFileSync(path.join(tmp, "index.html"), "<html><body>page</body></html>", "utf8");
    const fileResponse = vi.fn((file: string) => new Response(readFileSync(file, "utf8")));
    const { ctx } = makeCtx({
      config: { outDir: tmp, liveReload: false },
      state: { fileResponse }
    });
    const handler = createDevHandler(ctx, createReloadHub());
    const response = await handler(new Request("http://localhost/"));
    expect(await response.text()).not.toContain("EventSource");
  });

  it("passes through non-HTML assets unchanged (no injection)", async () => {
    writeFileSync(path.join(tmp, "main.css"), "body{color:red}", "utf8");
    const fileResponse = vi.fn((file: string) => new Response(readFileSync(file, "utf8")));
    const { ctx } = makeCtx({ config: { outDir: tmp, liveReload: true }, state: { fileResponse } });
    const handler = createDevHandler(ctx, createReloadHub());
    const response = await handler(new Request("http://localhost/main.css"));
    expect(await response.text()).toBe("body{color:red}");
  });

  it("returns 404 for a miss", async () => {
    const { ctx } = makeCtx({ config: { outDir: tmp } });
    const handler = createDevHandler(ctx, createReloadHub());
    const response = await handler(new Request("http://localhost/definitely-missing"));
    expect(response.status).toBe(404);
  });
});

describe("cli serve() wiring (injected seams)", () => {
  it("starts a server, registers watchers for each watchDir, and tears down on signal", async () => {
    const closes: string[] = [];
    const handlers = new Map<string, () => void>();
    const watch = vi.fn((dir: string, onChange: () => void): WatchHandle => {
      handlers.set(dir, onChange);
      return {
        close() {
          closes.push(dir);
        }
      };
    });
    const stop = vi.fn();
    const serveStatic = vi.fn(() => ({ stop }));
    const summary: BuildSummary = { outDir: "dist", pageCount: 2, durationMs: 5 };
    const { ctx, build, render } = makeCtx({
      config: { watchDirs: ["content", "src"], debounceMs: 0 },
      buildResult: summary,
      state: { watch, serveStatic }
    });

    vi.useFakeTimers();
    const servePromise = createApi(ctx).serve();
    // Let the initial build + server setup settle.
    await vi.advanceTimersByTimeAsync(0);

    expect(build.run).toHaveBeenCalledTimes(1);
    expect(serveStatic).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledTimes(2);

    // Fire a change on one watcher → debounced rebuild (debounceMs 0) → reload rendered.
    handlers.get("content")?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(build.run).toHaveBeenCalledTimes(2);
    const calls = (render as ReturnType<typeof makeCtx>["render"] & { calls: unknown[][] }).calls;
    expect(calls.some(call => call[0] === "reload")).toBe(true);
    expect(calls.some(call => call[0] === "serverReady")).toBe(true);

    // Teardown on SIGINT resolves the serve() promise and closes everything.
    process.emit("SIGINT");
    await servePromise;
    expect(stop).toHaveBeenCalledTimes(1);
    expect(closes).toEqual(["content", "src"]);
    vi.useRealTimers();
  });
});
