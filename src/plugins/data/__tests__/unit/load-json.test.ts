import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadJson } from "../../load-json";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadJson — Node branch (no document)", () => {
  it("reads and parses a JSON file from disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "loadjson-"));
    const file = path.join(dir, "data.json");
    await writeFile(file, JSON.stringify({ articles: [{ slug: "hello" }] }), "utf8");
    try {
      const data = await loadJson<{ articles: { slug: string }[] }>(file);
      expect(data.articles[0]?.slug).toBe("hello");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws when the file does not exist", async () => {
    await expect(loadJson("/no/such/file.json")).rejects.toThrow();
  });
});

describe("loadJson — browser branch (document defined)", () => {
  it("fetches and parses JSON over HTTP", async () => {
    vi.stubGlobal("document", {});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json([{ slug: "world" }], { status: 200 })))
    );
    const data = await loadJson<{ slug: string }[]>("/_data/en/articles.json");
    expect(data[0]?.slug).toBe("world");
  });

  it("throws a [web] error on a non-OK response", async () => {
    vi.stubGlobal("document", {});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("not found", { status: 404 })))
    );
    await expect(loadJson("/_data/en/articles.json")).rejects.toThrow(/\[web\] loadJson/);
  });
});
