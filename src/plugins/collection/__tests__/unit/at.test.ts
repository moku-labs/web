// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionPluginContext } from "../../api";
import { collectionApi } from "../../api";
import { createCollectionState } from "../../state";
import type { CollectionConfig, CollectionState } from "../../types";

const CFG: CollectionConfig = { baseUrl: "/" };

/** Build a browser-side collection ctx. */
function makeCtx(): { ctx: CollectionPluginContext; state: CollectionState } {
  const state = createCollectionState({ global: {}, config: CFG });
  return { ctx: { state, config: CFG }, state };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("collection.at(collection, shard) — browser read side", () => {
  it("fetches the per-shard URL (urlFor) and returns the raw parsed JSON", async () => {
    const { ctx } = makeCtx();
    const fetchSpy = vi.fn(() =>
      Promise.resolve(Response.json([{ slug: "cat" }], { status: 200 }))
    );
    vi.stubGlobal("fetch", fetchSpy);

    const data = await collectionApi(ctx).at("bank", "en/animals");
    expect(data).toEqual([{ slug: "cat" }]);
    expect(fetchSpy).toHaveBeenCalledWith("/bank/en/animals.json");
  });

  it("caches per (collection, shard) — a second at() does not re-fetch", async () => {
    const { ctx, state } = makeCtx();
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json({ x: 1 }, { status: 200 })));
    vi.stubGlobal("fetch", fetchSpy);

    await collectionApi(ctx).at("bank", "en/animals");
    await collectionApi(ctx).at("bank", "en/animals");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(state.cache.get("bank/en/animals")).toEqual({ x: 1 });
  });

  it("returns null on a non-OK fetch (consumer falls back)", async () => {
    const { ctx } = makeCtx();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 404 })))
    );
    expect(await collectionApi(ctx).at("bank", "en/animals")).toBeNull();
  });

  it("returns null when the body is not valid JSON", async () => {
    const { ctx } = makeCtx();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("<<not json>>", { status: 200 })))
    );
    expect(await collectionApi(ctx).at("bank", "en/animals")).toBeNull();
  });
});
