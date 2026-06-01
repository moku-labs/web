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
  vi.restoreAllMocks();
});

describe("data.at(path) — browser read side", () => {
  it("fetches the per-page URL (urlFor) and returns the raw parsed JSON", async () => {
    const { ctx } = makeCtx();
    const fetchSpy = vi.fn(() =>
      Promise.resolve(Response.json({ title: "Hello" }, { status: 200 }))
    );
    vi.stubGlobal("fetch", fetchSpy);

    const data = await dataApi(ctx).at("/en/hello/");
    expect(data).toEqual({ title: "Hello" });
    expect(fetchSpy).toHaveBeenCalledWith("/_data/en/hello/index.json");
  });

  it("caches per path — a second at() does not re-fetch", async () => {
    const { ctx, state } = makeCtx();
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json({ x: 1 }, { status: 200 })));
    vi.stubGlobal("fetch", fetchSpy);

    await dataApi(ctx).at("/en/hello/");
    await dataApi(ctx).at("/en/hello/");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(state.cache.get("/en/hello/")).toEqual({ x: 1 });
  });

  it("returns null on a non-OK fetch (spa falls back to HTML)", async () => {
    const { ctx } = makeCtx();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 404 })))
    );
    expect(await dataApi(ctx).at("/en/hello/")).toBeNull();
  });

  it("returns null when the body is not valid JSON", async () => {
    const { ctx } = makeCtx();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("<<not json>>", { status: 200 })))
    );
    expect(await dataApi(ctx).at("/en/hello/")).toBeNull();
  });
});
