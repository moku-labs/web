// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataPluginContext } from "../../api";
import { dataApi } from "../../api";
import { startPreload, stopPreload } from "../../preload";
import { createDataState } from "../../state";
import type { DataConfig, DataState } from "../../types";

const ALL: DataConfig = { outputDir: "_data", baseUrl: "/_data/", preload: "all" };
const NONE: DataConfig = { outputDir: "_data", baseUrl: "/_data/", preload: "none" };

/** The bundle a build writes: every page's data keyed by its page path. */
const BUNDLE = { "/": { home: true }, "/en/a/": { a: 1 }, "/en/b/": { b: 2 } };

/** Build a browser-side data ctx for one config. */
function makeCtx(config: DataConfig): { ctx: DataPluginContext; state: DataState } {
  const state = createDataState({ global: {}, config });
  return { ctx: { state, config }, state };
}

/** A fetch stub that serves the bundle and echoes the URL for single files. */
function serveBundle(): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) =>
    Promise.resolve(
      url === "/_data/_all.json"
        ? Response.json(BUNDLE, { status: 200 })
        : Response.json({ single: url }, { status: 200 })
    )
  );
}

/** A fetch stub whose bundle response waits until `release()` is called. */
function gatedBundle(): { fetchSpy: ReturnType<typeof vi.fn>; release: () => void } {
  const { promise: gate, resolve: release } = Promise.withResolvers<void>();
  const fetchSpy = vi.fn(async (url: string) => {
    if (url !== "/_data/_all.json") return Response.json({ single: url }, { status: 200 });
    await gate;
    return Response.json(BUNDLE, { status: 200 });
  });
  return { fetchSpy, release };
}

/** Run idle work now: requestIdleCallback calls back on the next macrotask. */
function stubIdle(): void {
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => setTimeout(callback, 0));
  vi.stubGlobal("cancelIdleCallback", (handle: number) => clearTimeout(handle));
}

/** Wait a few macrotasks: the idle callback runs and stubbed fetches settle. */
async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 5));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("data preload: 'all' fills the cache from one bundle", () => {
  // Bug: the bundle is fetched but the cache is never filled, so every SPA
  // navigation still pays one network round trip.
  it("fetches _all.json once when idle and caches every path", async () => {
    stubIdle();
    const fetchSpy = serveBundle();
    vi.stubGlobal("fetch", fetchSpy);
    const { ctx, state } = makeCtx(ALL);

    startPreload(ctx);
    await tick();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/_data/_all.json");
    expect(state.cache.get("/en/a/")).toEqual({ a: 1 });
    expect(state.cache.get("/")).toEqual({ home: true });

    expect(await dataApi(ctx).at("/en/b/")).toEqual({ b: 2 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // Bug: the bundle overwrites a path the page already fetched fresh, and a
  // reader holding that object sees the data change under it.
  it("keeps a path that is already cached", async () => {
    stubIdle();
    vi.stubGlobal("fetch", serveBundle());
    const { ctx, state } = makeCtx(ALL);
    const fresh = { a: "fresh" };
    state.cache.set("/en/a/", fresh);

    startPreload(ctx);
    await tick();

    expect(state.cache.get("/en/a/")).toBe(fresh);
  });

  // Bug: with the default "none" the plugin starts loading a bundle the build
  // never wrote, a wasted 404 on every page load.
  it("does nothing with preload 'none'", async () => {
    stubIdle();
    const fetchSpy = serveBundle();
    vi.stubGlobal("fetch", fetchSpy);
    const { ctx, state } = makeCtx(NONE);

    startPreload(ctx);
    await tick();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.cancelPreload).toBeNull();
  });

  // Bug: a user who asked the browser to save data still downloads every page.
  it("skips the bundle when save-data is on", async () => {
    stubIdle();
    const fetchSpy = serveBundle();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    const { ctx } = makeCtx(ALL);

    startPreload(ctx);
    await tick();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Bug: a missing bundle throws out of the idle callback, or poisons at() so
  // navigation falls back to full HTML loads.
  it("a failed bundle fetch is silent and lazy at() still works", async () => {
    stubIdle();
    const fetchSpy = vi.fn((url: string) =>
      Promise.resolve(
        url === "/_data/_all.json"
          ? new Response("missing", { status: 404 })
          : Response.json({ single: url }, { status: 200 })
      )
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { ctx, state } = makeCtx(ALL);

    startPreload(ctx);
    await tick();

    expect(state.cache.size).toBe(0);
    expect(state.cancelPreload).toBeNull();
    expect(await dataApi(ctx).at("/en/a/")).toEqual({ single: "/_data/en/a/index.json" });
  });

  // Bug: without requestIdleCallback (Safari) the preload never runs.
  it("falls back to setTimeout when requestIdleCallback is missing", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.stubGlobal("fetch", serveBundle());
    const { ctx, state } = makeCtx(ALL);

    startPreload(ctx);
    await tick();

    expect(state.cache.get("/en/a/")).toEqual({ a: 1 });
  });
});

describe("data preload: at() while the bundle is in flight", () => {
  // Bug: a click right after load waits for the whole bundle download
  // (855 ms vs 653 ms with no preload on slow 4G). at() must fetch the
  // single file at once and resolve before the bundle does.
  it("starts the single-file fetch at once and resolves before the bundle", async () => {
    stubIdle();
    const { fetchSpy, release } = gatedBundle();
    vi.stubGlobal("fetch", fetchSpy);
    const { ctx, state } = makeCtx(ALL);

    startPreload(ctx);
    await tick();
    expect(fetchSpy).toHaveBeenCalledWith("/_data/_all.json", expect.anything());

    const read = dataApi(ctx).at("/en/a/");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[0]).toBe("/_data/en/a/index.json");
    expect(await read).toEqual({ single: "/_data/en/a/index.json" });
    expect(state.cancelPreload).not.toBeNull();

    release();
    await tick();
    expect(state.cache.get("/en/a/")).toEqual({ single: "/_data/en/a/index.json" });
    expect(state.cache.get("/en/b/")).toEqual({ b: 2 });
    expect(state.pending.size).toBe(0);
  });

  // Bug: a single file that lands after the bundle fill throws, or leaves a
  // stale pending entry, so the next at() for that path hangs or refetches.
  it("a single file that finishes after the fill still resolves and clears pending", async () => {
    stubIdle();
    const { promise: slow, resolve: releaseSingle } = Promise.withResolvers<void>();
    const fetchSpy = vi.fn(async (url: string) => {
      if (url === "/_data/_all.json") return Response.json(BUNDLE, { status: 200 });
      await slow;
      return Response.json({ single: url }, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { ctx, state } = makeCtx(ALL);

    startPreload(ctx);
    const read = dataApi(ctx).at("/en/a/");
    await tick();
    expect(state.cache.get("/en/a/")).toEqual({ a: 1 });

    releaseSingle();
    expect(await read).toEqual({ single: "/_data/en/a/index.json" });
    expect(state.pending.size).toBe(0);
    expect(await dataApi(ctx).at("/en/a/")).toEqual(state.cache.get("/en/a/"));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("data preload: stop", () => {
  // Bug: app.stop() leaves the idle callback queued, so a stopped app still
  // downloads the bundle.
  it("cancels a scheduled preload", async () => {
    stubIdle();
    const fetchSpy = serveBundle();
    vi.stubGlobal("fetch", fetchSpy);
    const { ctx } = makeCtx(ALL);

    startPreload(ctx);
    stopPreload(ctx);
    await tick();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Bug: app.stop() leaves the bundle request open and it fills the cache of a
  // stopped app.
  it("aborts an in-flight bundle fetch", async () => {
    stubIdle();
    let seenSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        seenSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          seenSignal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      })
    );
    const { ctx, state } = makeCtx(ALL);

    startPreload(ctx);
    await tick();
    expect(seenSignal).toBeDefined();
    stopPreload(ctx);
    await tick();

    expect(seenSignal?.aborted).toBe(true);
    expect(state.cache.size).toBe(0);
    expect(state.cancelPreload).toBeNull();
  });
});
