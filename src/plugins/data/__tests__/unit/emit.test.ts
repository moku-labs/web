import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DataPluginContext } from "../../api";
import { dataApi } from "../../api";
import { createDataState } from "../../state";
import type {
  DataConfig,
  DataState,
  RouteIndexFile,
  SidecarData,
  SidecarFragment
} from "../../types";

/**
 * A minimal router-API stub exposing the `manifest()`/`entries()` surface emit
 * consumes: one static `home` route + one parametric `article` route expanding to
 * two slugs. `toUrl`/`toFile` mirror the default derivation build uses on disk.
 */
function makeRouter() {
  const slugs = ["hello", "world"];
  return {
    entries: () => [
      {
        pattern: "/",
        name: "home",
        meta: { kind: "index" },
        toUrl: () => "/",
        toFile: () => "index.html"
      },
      {
        pattern: "/{slug}/",
        name: "article",
        meta: { kind: "post" },
        toUrl: (p: Record<string, string>) => `/${p.slug}/`,
        toFile: (p: Record<string, string>) => `${p.slug}/index.html`
      }
    ],
    manifest: () => [
      { pattern: "/", _meta: {}, _handlers: { render: () => ({}) as never } },
      {
        pattern: "/{slug}/",
        _meta: {},
        _handlers: {
          generate: () => slugs.map(slug => ({ slug })),
          load: (p: Record<string, string>) => ({ title: `Post ${p.slug}` }),
          toJson: (ctx: { data: unknown }) => ctx.data
        }
      }
    ]
  };
}

/** A content-API stub: `loadAll()` returns one locale ("en") so emit expands once. */
function makeContent() {
  return { loadAll: () => Promise.resolve(new Map([["en", []]])) };
}

/** Build the data plugin ctx wired to the router/content stubs. */
function makeCtx(config: DataConfig): { ctx: DataPluginContext; state: DataState } {
  const byName: Record<string, unknown> = { router: makeRouter(), content: makeContent() };
  const state: DataState = createDataState({ global: {}, config });
  const ctx: DataPluginContext = {
    state,
    config,
    require: ((plugin: { name: string }) => byName[plugin.name]) as DataPluginContext["require"]
  };
  return { ctx, state };
}

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(path.join(tmpdir(), "moku-data-emit-"));
  // Pre-write the SSR HTML build output emit reuses for "fragment" sidecars.
  for (const [file, body] of [
    ["index.html", "<h1>Home</h1>"],
    ["hello/index.html", "<h1>hello</h1>"],
    ["world/index.html", "<h1>world</h1>"]
  ] as const) {
    const filePath = path.join(outDir, file);
    mkdirSync(path.join(filePath, ".."), { recursive: true });
    writeFileSync(
      filePath,
      `<!DOCTYPE html><html><head></head><body>${body}</body></html>`,
      "utf8"
    );
  }
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

const FRAGMENT_CFG: DataConfig = { outputDir: "_data", baseUrl: "/_data/", payload: "fragment" };
const DATA_CFG: DataConfig = { outputDir: "_data", baseUrl: "/_data/", payload: "data" };

/** Read + parse the emitted route-index manifest under `<outDir>/_data/`. */
function readManifest(): RouteIndexFile {
  return JSON.parse(readFileSync(path.join(outDir, "_data", "routes-manifest.json"), "utf8"));
}

describe("data.emit() — Node write side", () => {
  it("writes a STABLE un-hashed routes-manifest.json + one sidecar per concrete page", async () => {
    const { ctx, state } = makeCtx(FRAGMENT_CFG);
    const summary = await dataApi(ctx).emit({ outDir });

    expect(summary.outDir).toBe(outDir);
    expect(summary.manifestPath).toBe(path.join(outDir, "_data", "routes-manifest.json"));
    // 3 concrete pages: / , /hello/ , /world/
    expect(summary.sidecarCount).toBe(3);
    expect(state.lastEmit).toEqual(summary);

    const manifest = readManifest();
    expect(manifest.buildId).toMatch(/^[\da-f]{16}$/);
    expect(manifest.routes.map(r => r.pattern).toSorted()).toEqual(["/", "/hello/", "/world/"]);
  });

  it("references each sidecar by a CONTENT-HASHED dataUrl under baseUrl", async () => {
    const { ctx } = makeCtx(FRAGMENT_CFG);
    await dataApi(ctx).emit({ outDir });
    const manifest = readManifest();

    for (const route of manifest.routes) {
      expect(route.dataUrl).toMatch(/^\/_data\/.+\.[\da-f]{16}\.json$/);
      // The hashed sidecar exists on disk and parses.
      const fileName = route.dataUrl.replace("/_data/", "");
      expect(readdirSync(path.join(outDir, "_data"))).toContain(fileName);
    }
  });

  it('emits "fragment" sidecars carrying the on-disk <body> HTML (no re-render)', async () => {
    const { ctx } = makeCtx(FRAGMENT_CFG);
    await dataApi(ctx).emit({ outDir });
    const manifest = readManifest();

    const hello = manifest.routes.find(r => r.pattern === "/hello/");
    if (!hello) throw new Error("expected a /hello/ manifest route");
    const sidecar: SidecarFragment = JSON.parse(
      readFileSync(path.join(outDir, "_data", hello.dataUrl.replace("/_data/", "")), "utf8")
    );
    expect(sidecar.html).toBe("<h1>hello</h1>");
    expect(sidecar.meta).toEqual({ kind: "post" });
  });

  it('emits "data" sidecars carrying the route\'s serialized data', async () => {
    const { ctx } = makeCtx(DATA_CFG);
    await dataApi(ctx).emit({ outDir });
    const manifest = readManifest();

    const hello = manifest.routes.find(r => r.pattern === "/hello/");
    if (!hello) throw new Error("expected a /hello/ manifest route");
    const sidecar: SidecarData = JSON.parse(
      readFileSync(path.join(outDir, "_data", hello.dataUrl.replace("/_data/", "")), "utf8")
    );
    expect(sidecar.data).toEqual({ title: "Post hello" });
  });

  it("defaults outDir to ./dist when no override is given", async () => {
    const { ctx } = makeCtx(FRAGMENT_CFG);
    // No HTML pre-written under ./dist, so fragment sidecars are skipped, but the
    // manifest must still be written under the default outDir.
    const summary = await dataApi(ctx).emit();
    try {
      expect(summary.outDir).toBe("./dist");
      expect(summary.manifestPath).toBe(path.join("./dist", "_data", "routes-manifest.json"));
    } finally {
      rmSync("./dist/_data", { recursive: true, force: true });
    }
  });
});
