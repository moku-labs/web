import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApi } from "../../api";
import {
  createChangeGate,
  createDevHandler,
  createRebuilder,
  createReloadHub,
  injectReloadClient,
  RELOAD_PATH
} from "../../serve";
import type { BuildSummary, ReloadInfo, WatchHandle } from "../../types";
import { type CaptureRenderer, makeCtx } from "../helpers";

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

  it("coalesces a change arriving mid-rebuild into exactly one extra rerun", async () => {
    const summary: BuildSummary = { outDir: "dist", pageCount: 1, durationMs: 1 };
    // A slow first build so a change can land while the rebuild is in flight; later
    // builds resolve immediately.
    let resolveFirst: (() => void) | undefined;
    let calls = 0;
    const runBuild = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>(resolve => {
          resolveFirst = resolve;
        });
      }
      return summary;
    });
    const reloads: ReloadInfo[] = [];
    const rebuilder = createRebuilder({
      debounceMs: 10,
      runBuild,
      onReloaded: info => reloads.push(info),
      onError: () => undefined
    });

    // First change fires a rebuild that is now in flight (not yet resolved).
    rebuilder.schedule("a.md");
    await vi.advanceTimersByTimeAsync(10);
    expect(runBuild).toHaveBeenCalledTimes(1);

    // A change arrives mid-rebuild → debounced timer fires while building → marked dirty.
    rebuilder.schedule("b.md");
    await vi.advanceTimersByTimeAsync(10);
    expect(runBuild).toHaveBeenCalledTimes(1);

    // Settle the first build → exactly one coalesced rerun for the latest file.
    resolveFirst?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(runBuild).toHaveBeenCalledTimes(2);
    expect(reloads.map(info => info.file)).toEqual(["a.md", "b.md"]);
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

  it("starts the dev server with idleTimeout 0 (keeps the live-reload SSE stream open)", async () => {
    const serveStatic = vi.fn(() => ({
      stop() {
        // no-op
      }
    }));
    const watch = vi.fn(
      (): WatchHandle => ({
        close() {
          // no-op
        }
      })
    );
    const { ctx } = makeCtx({ state: { serveStatic, watch } });

    vi.useFakeTimers();
    const servePromise = createApi(ctx).serve();
    await vi.advanceTimersByTimeAsync(0);
    expect(serveStatic).toHaveBeenCalledWith(expect.objectContaining({ idleTimeout: 0 }));

    process.emit("SIGINT");
    await servePromise;
    vi.useRealTimers();
  });

  it("does not rebuild for an ignored (noise) watch event — the gate is wired", async () => {
    const handlers = new Map<string, (filename?: string) => void>();
    const watch = vi.fn((dir: string, onChange: (filename?: string) => void): WatchHandle => {
      handlers.set(dir, onChange);
      return {
        close() {
          // no-op
        }
      };
    });
    const serveStatic = vi.fn(() => ({
      stop() {
        // no-op
      }
    }));
    const { ctx, build } = makeCtx({
      config: { watchDirs: ["content"], debounceMs: 0, outDir: "dist" },
      state: { watch, serveStatic }
    });

    vi.useFakeTimers();
    const servePromise = createApi(ctx).serve();
    await vi.advanceTimersByTimeAsync(0);
    expect(build.run).toHaveBeenCalledTimes(1); // initial build only

    handlers.get("content")?.(".DS_Store"); // noise ⇒ the gate rejects ⇒ no rebuild
    await vi.advanceTimersByTimeAsync(0);
    expect(build.run).toHaveBeenCalledTimes(1); // still no rebuild

    process.emit("SIGINT");
    await servePromise;
    vi.useRealTimers();
  });

  it("announces rebuildStart before reload on each rebuild", async () => {
    const handlers = new Map<string, (filename?: string) => void>();
    const watch = vi.fn((dir: string, onChange: (filename?: string) => void): WatchHandle => {
      handlers.set(dir, onChange);
      return {
        close() {
          // no-op
        }
      };
    });
    const serveStatic = vi.fn(() => ({
      stop() {
        // no-op
      }
    }));
    const { ctx, render } = makeCtx({
      config: { watchDirs: ["content"], debounceMs: 0 },
      state: { watch, serveStatic }
    });

    vi.useFakeTimers();
    const servePromise = createApi(ctx).serve();
    await vi.advanceTimersByTimeAsync(0);

    handlers.get("content")?.(); // no filename ⇒ accepted ⇒ one rebuild
    await vi.advanceTimersByTimeAsync(0);

    const names = (render as CaptureRenderer).calls.map(call => call[0]);
    const startIndex = names.indexOf("rebuildStart");
    const reloadIndex = names.indexOf("reload");
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(reloadIndex).toBeGreaterThan(startIndex);

    process.emit("SIGINT");
    await servePromise;
    vi.useRealTimers();
  });
});

describe("cli/createChangeGate (watch-event filter)", () => {
  it("accepts when the platform reports no filename (cannot filter — rebuild)", () => {
    const gate = createChangeGate({ outDir: "dist", fileMtime: () => 9e9, now: () => 0 });
    expect(gate.accept("content", undefined)).toBe(true);
  });

  it("ignores dotfiles, dot-segments, and backup~ files (editor/OS noise)", () => {
    const gate = createChangeGate({ outDir: "dist", fileMtime: () => 9e9, now: () => 0 });
    expect(gate.accept("content", ".DS_Store")).toBe(false);
    expect(gate.accept("content", "post/.git/HEAD")).toBe(false);
    expect(gate.accept("content", "post/en.md~")).toBe(false);
  });

  it("ignores writes under outDir (the build's own output — loop guard)", () => {
    const gate = createChangeGate({ outDir: "dist", fileMtime: () => 9e9, now: () => 0 });
    expect(gate.accept(".", "dist/index.html")).toBe(false);
  });

  it("ignores files last modified at/before serve start (pre-existing / stale echo)", () => {
    // High-water starts at now()=1000; a file with mtime 500 predates it ⇒ already built.
    const gate = createChangeGate({ outDir: "dist", fileMtime: () => 500, now: () => 1000 });
    expect(gate.accept("content", "old.md")).toBe(false);
  });

  it("accepts a file modified after the last build started (a real edit)", () => {
    const gate = createChangeGate({ outDir: "dist", fileMtime: () => 1500, now: () => 1000 });
    expect(gate.accept("content", "new.md")).toBe(true);
  });

  it("drops a save's duplicate + parent-dir echoes once its build has started", () => {
    let clock = 1000;
    const gate = createChangeGate({ outDir: "dist", fileMtime: () => 1500, now: () => clock });
    // The triggering event (file newer than serve start) is accepted.
    expect(gate.accept("content", "a.md")).toBe(true);
    // The build starts → the high-water mark advances past the save's mtime.
    clock = 3000;
    gate.markBuildStart();
    // The duplicate file echo + the separate parent-dir echo are now stale (mtime ≤ HWM).
    expect(gate.accept("content", "a.md")).toBe(false);
    expect(gate.accept("content", "a")).toBe(false);
  });

  it("still accepts a genuinely newer edit made mid-build", () => {
    let clock = 1000;
    let mtime = 1500;
    const gate = createChangeGate({ outDir: "dist", fileMtime: () => mtime, now: () => clock });
    expect(gate.accept("content", "a.md")).toBe(true);
    clock = 3000;
    gate.markBuildStart();
    // A real edit during the build advances the file's mtime past the build-start mark.
    mtime = 4000;
    expect(gate.accept("content", "a.md")).toBe(true);
  });

  it("treats a missing file (deletion) as a real change", () => {
    // eslint-disable-next-line unicorn/no-null -- fileMtime returns null for a missing file.
    const gate = createChangeGate({ outDir: "dist", fileMtime: () => null, now: () => 1000 });
    expect(gate.accept("content", "gone.md")).toBe(true);
  });
});

describe("cli/createReloadHub heartbeat + close", () => {
  it("pings connected clients on the heartbeat interval and stops on close()", async () => {
    vi.useFakeTimers();
    const hub = createReloadHub({ heartbeatMs: 1000 });
    const response = hub.connect();
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await reader.read(); // the open comment

    await vi.advanceTimersByTimeAsync(1000);
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain(": ping");

    hub.close();
    expect(hub.size()).toBe(0);
    await reader.cancel();
    vi.useRealTimers();
  });

  it("does not start a heartbeat when heartbeatMs is 0", async () => {
    vi.useFakeTimers();
    const hub = createReloadHub({ heartbeatMs: 0 });
    const response = hub.connect();
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await reader.read(); // the open comment

    // Advance well past any interval — no ping should ever arrive.
    let pinged = false;
    const pending = reader.read().then(({ value }) => {
      if (value && new TextDecoder().decode(value).includes("ping")) pinged = true;
    });
    await vi.advanceTimersByTimeAsync(60_000);
    hub.close(); // closes the stream so the pending read settles
    await pending;
    expect(pinged).toBe(false);
    vi.useRealTimers();
  });
});
