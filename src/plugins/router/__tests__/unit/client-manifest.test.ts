import { describe, expect, it } from "vitest";
import { createApi } from "../../api";
import { compileRoutes } from "../../builders/compile";
import { matchRoute } from "../../builders/match";
import { route } from "../../builders/route-builder";
import { compileClientMatcher } from "../../iso-match";
import type { CompileInput, RouterState } from "../../types";

/** Standard compile input used across the clientManifest scenarios. */
function makeInput(routes: CompileInput["routes"]): CompileInput {
  return {
    routes,
    mode: "hybrid",
    baseUrl: "https://blog.dev",
    locales: ["en", "uk"],
    defaultLocale: "en"
  };
}

/** Module-scoped route load handler used by the `_handlers` absence test. */
function load(): { n: number } {
  return { n: 1 };
}

/** Build an api over a compiled table from the given declaration-ordered routes. */
function makeApi(routes: CompileInput["routes"]) {
  const table = compileRoutes(makeInput(routes));
  const state: RouterState = { table, mode: "hybrid" };
  return { api: createApi({ state }), table };
}

describe("clientManifest()", () => {
  it("is JSON-serializable (round-trip equals input)", () => {
    const { api } = makeApi({
      home: route("/").meta({ nav: true, order: 1 }),
      article: route("/{slug}/").meta({ tags: ["a", "b"] })
    });
    const manifest = api.clientManifest();
    // eslint-disable-next-line unicorn/prefer-structured-clone -- a JSON round-trip is the assertion: it proves JSON-serializability, which structuredClone would not.
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it("contains no _handlers closures", () => {
    const { api } = makeApi({
      home: route("/"),
      article: route("/{slug}/").load(load)
    });
    for (const entry of api.clientManifest()) {
      expect(entry).not.toHaveProperty("_handlers");
      expect(Object.keys(entry).toSorted()).toEqual(["meta", "name", "pattern"]);
    }
  });

  it("exposes only pattern/name/meta per entry", () => {
    const { api } = makeApi({ home: route("/").meta({ x: 1 }) });
    const [entry] = api.clientManifest();
    expect(entry).toEqual({ pattern: "/", name: "home", meta: { x: 1 } });
  });

  it("is specificity-sorted (static before dynamic), same order as the table", () => {
    const { api, table } = makeApi({
      deep: route("/{a}/{b}/"),
      about: route("/about/"),
      post: route("/{slug}/")
    });
    const manifest = api.clientManifest();
    expect(manifest.map(r => r.name)).toEqual(table.compiled.map(c => c.name));
    expect(manifest[0]?.name).toBe("about");
    expect(manifest.at(-1)?.name).toBe("deep");
  });

  it("returns a fresh frozen copy (mutation does not affect state)", () => {
    const { api } = makeApi({ home: route("/"), about: route("/about/") });
    const first = api.clientManifest();
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => (first as unknown[]).pop()).toThrow();
    expect(api.clientManifest()).toHaveLength(2);
  });

  it("meta is a fresh copy — mutation does not leak into the table", () => {
    const { api } = makeApi({ home: route("/").meta({ count: 1 }) });
    const a = api.clientManifest();
    (a[0]?.meta as Record<string, unknown>).count = 99;
    expect(api.clientManifest()[0]?.meta).toEqual({ count: 1 });
  });
});

describe("PARITY GATE: server match vs client matcher from clientManifest()", () => {
  it("resolves identical route names for a URL fixture, specificity order preserved", () => {
    const { api, table } = makeApi({
      deep: route("/{a}/{b}/"),
      about: route("/about/"),
      article: route("/{lang:?}/{slug}/"),
      home: route("/")
    });

    const manifest = api.clientManifest();
    // Client recompiles matchers lazily from the shipped (specificity-sorted) strings.
    const clientTable = manifest.map(r => ({
      name: r.name,
      matcher: compileClientMatcher(r.pattern)
    }));

    /** Resolve a pathname to a route name using the client matcher table. */
    function clientMatchName(pathname: string): string | undefined {
      for (const entry of clientTable) {
        if (entry.matcher(pathname)) return entry.name;
      }
      return undefined;
    }

    /** Resolve a pathname to a route name using the server matcher table. */
    function serverMatchName(pathname: string): string | undefined {
      const hit = matchRoute(table.compiled, pathname);
      return hit ? table.compiled.find(c => c.definition === hit.route)?.name : undefined;
    }

    // Fixtures cover static, valid-locale-prefixed, and bare-dynamic SPA paths.
    const fixtures = ["/about/", "/en/hello/", "/uk/world/", "/some-slug/", "/"];
    for (const url of fixtures) {
      expect(clientMatchName(url)).toBe(serverMatchName(url));
    }
  });

  it("specificity order of clientManifest equals server compiled order", () => {
    const { api, table } = makeApi({
      deep: route("/{a}/{b}/"),
      about: route("/about/"),
      post: route("/{slug}/"),
      home: route("/")
    });
    expect(api.clientManifest().map(r => r.pattern)).toEqual(table.compiled.map(c => c.pattern));
  });
});
