import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CollectionPluginContext } from "../../api";
import { collectionApi } from "../../api";
import { createCollectionState } from "../../state";
import type { CollectionConfig, CollectionShard, CollectionState } from "../../types";

const CFG: CollectionConfig = { baseUrl: "/" };

/** Build a collection plugin ctx (write side needs only state + config). */
function makeCtx(): { ctx: CollectionPluginContext; state: CollectionState } {
  const state: CollectionState = createCollectionState({ global: {}, config: CFG });
  return { ctx: { state, config: CFG }, state };
}

const ENTRIES: CollectionShard[] = [
  { collection: "bank", shard: "ru", data: { cards: [{ slug: "hello" }] } },
  { collection: "bank", shard: "en/animals", data: [{ slug: "cat" }, { slug: "dog" }] }
];

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(path.join(tmpdir(), "moku-collection-write-"));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("collection.write() — Node persist side (agnostic, per-shard)", () => {
  it("writes one JSON file per entry, keyed by (collection, shard)", async () => {
    const { ctx, state } = makeCtx();
    const summary = await collectionApi(ctx).write(ENTRIES, { outDir });

    expect(summary.fileCount).toBe(2);
    expect(summary.files.toSorted()).toEqual([
      path.join("bank", "en", "animals.json"),
      path.join("bank", "ru.json")
    ]);
    expect(state.lastWrite).toEqual(summary);

    const ru = JSON.parse(readFileSync(path.join(outDir, "bank", "ru.json"), "utf8"));
    expect(ru).toEqual({ cards: [{ slug: "hello" }] });
    const animals = JSON.parse(
      readFileSync(path.join(outDir, "bank", "en", "animals.json"), "utf8")
    );
    expect(animals).toEqual([{ slug: "cat" }, { slug: "dog" }]);
  });

  it("persists arbitrary data verbatim — no domain coupling, no transform", async () => {
    const { ctx } = makeCtx();
    await collectionApi(ctx).write(
      [{ collection: "metrics", shard: "live", data: [{ rps: 42 }] }],
      {
        outDir
      }
    );
    const raw = JSON.parse(readFileSync(path.join(outDir, "metrics", "live.json"), "utf8"));
    expect(raw).toEqual([{ rps: 42 }]);
  });

  it("reports total byte count and defaults outDir to ./dist", async () => {
    const { ctx } = makeCtx();
    const summary = await collectionApi(ctx).write([
      { collection: "bank", shard: "x", data: { a: 1 } }
    ]);
    try {
      expect(summary.bytes).toBe(Buffer.byteLength(JSON.stringify({ a: 1 }), "utf8"));
    } finally {
      rmSync("./dist/bank", { recursive: true, force: true });
    }
  });
});

describe("collection.urlFor() / fileFor() — the shared convention", () => {
  it("derives a fetch URL and an outDir-relative file from a key", () => {
    const api = collectionApi(makeCtx().ctx);
    expect(api.urlFor("bank", "en/animals")).toBe("/bank/en/animals.json");
    expect(api.fileFor("bank", "en/animals")).toBe("bank/en/animals.json");
    expect(api.urlFor("bank", "ru")).toBe("/bank/ru.json");
    expect(api.fileFor("bank", "ru")).toBe("bank/ru.json");
  });

  it("trims outer slashes from collection and shard", () => {
    const api = collectionApi(makeCtx().ctx);
    expect(api.urlFor("/bank/", "/en/")).toBe("/bank/en.json");
    expect(api.fileFor("/bank/", "/en/")).toBe("bank/en.json");
  });
});
