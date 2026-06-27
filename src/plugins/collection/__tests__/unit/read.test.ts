import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCollectionShard } from "../../read";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadCollectionShard — fetch-based shard reader", () => {
  it("fetches collectionUrl(...) and returns the parsed JSON on a 200", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(Response.json([{ slug: "cat" }], { status: 200 }))
    );
    vi.stubGlobal("fetch", fetchSpy);

    const data = await loadCollectionShard<{ slug: string }[]>("/", "bank", "en/animals");
    expect(data[0]?.slug).toBe("cat");
    expect(fetchSpy).toHaveBeenCalledWith("/bank/en/animals.json");
  });

  it("throws a [web] collection error on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("not found", { status: 404 })))
    );
    await expect(loadCollectionShard("/", "bank", "en/animals")).rejects.toThrow(
      /\[web\] collection: failed to fetch \/bank\/en\/animals\.json \(404\)\./
    );
  });
});
