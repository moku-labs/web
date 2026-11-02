// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataPluginContext } from "../../api";
import { dataApi } from "../../api";
import { createDataState } from "../../state";
import type { DataConfig, DataState } from "../../types";

const CFG: DataConfig = { outputDir: "_data", baseUrl: "/_data/" };

/** Build a browser-side data ctx. */
function makeCtx(): { ctx: DataPluginContext; state: DataState } {
  const state = createDataState({ global: {}, config: CFG });
  return { ctx: { state, config: CFG }, state };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("data.at(path) — one request per path while in flight", () => {
  // Bug: touchstart warms at(path), the click 120 ms later calls at(path) again
  // before the first fetch resolves, and a second identical request goes out.
  it("two concurrent at() calls for one path start one fetch and both get the data", async () => {
    const { ctx, state } = makeCtx();
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json({ x: 1 }, { status: 200 })));
    vi.stubGlobal("fetch", fetchSpy);
    const api = dataApi(ctx);

    const [a, b] = await Promise.all([api.at("/en/hello/"), api.at("/en/hello/")]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ x: 1 });
    expect(b).toEqual({ x: 1 });
    expect(state.cache.get("/en/hello/")).toEqual({ x: 1 });
    expect(state.pending.size).toBe(0);
  });

  // Bug: caching the failed promise (or leaving it pending) makes one network
  // blip permanent, so every later at(path) returns null without retrying.
  it("after a failed fetch, a later call fetches again", async () => {
    const { ctx, state } = makeCtx();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ x: 2 }, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const api = dataApi(ctx);

    expect(await api.at("/en/hello/")).toBeNull();
    expect(state.cache.has("/en/hello/")).toBe(false);
    expect(state.pending.size).toBe(0);

    expect(await api.at("/en/hello/")).toEqual({ x: 2 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // Bug: keying the in-flight entry by anything coarser than the path would
  // hand one page's data to another page.
  it("different paths still fetch separately", async () => {
    const { ctx } = makeCtx();
    const fetchSpy = vi.fn((url: string) =>
      Promise.resolve(Response.json({ url }, { status: 200 }))
    );
    vi.stubGlobal("fetch", fetchSpy);
    const api = dataApi(ctx);

    const [a, b] = await Promise.all([api.at("/en/a/"), api.at("/en/b/")]);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(a).toEqual({ url: "/_data/en/a/index.json" });
    expect(b).toEqual({ url: "/_data/en/b/index.json" });
  });
});
