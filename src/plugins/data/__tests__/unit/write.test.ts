import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DataPluginContext } from "../../api";
import { dataApi } from "../../api";
import { createDataState } from "../../state";
import type { DataConfig, DataEntry, DataState } from "../../types";

const CFG: DataConfig = { outputDir: "_data", baseUrl: "/_data/" };

/** Build a data plugin ctx (write side needs only state + config). */
function makeCtx(): { ctx: DataPluginContext; state: DataState } {
  const state: DataState = createDataState({ global: {}, config: CFG });
  return { ctx: { state, config: CFG }, state };
}

const ENTRIES: DataEntry[] = [
  { path: "/", data: { cards: [{ slug: "hello" }] } },
  { path: "/en/hello/", data: { slug: "hello", title: "Hello", body: "<p>hi</p>" } }
];

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(path.join(tmpdir(), "moku-data-write-"));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("data.write() — Node persist side (agnostic, per-page)", () => {
  it("writes one JSON file per entry mirroring the page URL", async () => {
    const { ctx, state } = makeCtx();
    const summary = await dataApi(ctx).write(ENTRIES, { outDir });

    expect(summary.fileCount).toBe(2);
    expect(summary.files.toSorted()).toEqual([
      path.join("_data", "en", "hello", "index.json"),
      path.join("_data", "index.json")
    ]);
    expect(state.lastWrite).toEqual(summary);

    const root = JSON.parse(readFileSync(path.join(outDir, "_data", "index.json"), "utf8"));
    expect(root).toEqual({ cards: [{ slug: "hello" }] });
    const article = JSON.parse(
      readFileSync(path.join(outDir, "_data", "en", "hello", "index.json"), "utf8")
    );
    expect(article.title).toBe("Hello");
  });

  it("persists arbitrary data verbatim — no domain coupling, no transform", async () => {
    const { ctx } = makeCtx();
    // A totally non-blog shape proves agnosticism.
    await dataApi(ctx).write([{ path: "/metrics/", data: [{ key: "rps", value: 42 }] }], {
      outDir
    });
    const raw = JSON.parse(
      readFileSync(path.join(outDir, "_data", "metrics", "index.json"), "utf8")
    );
    expect(raw).toEqual([{ key: "rps", value: 42 }]);
  });

  it("reports total byte count and defaults outDir to ./dist", async () => {
    const { ctx } = makeCtx();
    const summary = await dataApi(ctx).write([{ path: "/", data: { a: 1 } }]);
    try {
      expect(summary.bytes).toBe(Buffer.byteLength(JSON.stringify({ a: 1 }), "utf8"));
    } finally {
      rmSync("./dist/_data", { recursive: true, force: true });
    }
  });
});

describe("data.urlFor() / fileFor() — the shared convention", () => {
  it("mirrors the page URL into a fetch URL and an outDir-relative file", () => {
    const api = dataApi(makeCtx().ctx);
    expect(api.urlFor("/en/hello/")).toBe("/_data/en/hello/index.json");
    expect(api.fileFor("/en/hello/")).toBe("_data/en/hello/index.json");
    expect(api.urlFor("/")).toBe("/_data/index.json");
    expect(api.fileFor("/")).toBe("_data/index.json");
  });

  it("normalizes a missing trailing slash and strips a query string", () => {
    const api = dataApi(makeCtx().ctx);
    expect(api.urlFor("/en/hello")).toBe("/_data/en/hello/index.json");
    expect(api.urlFor("/en/hello/?x=1")).toBe("/_data/en/hello/index.json");
  });
});
