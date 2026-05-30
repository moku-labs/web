/* eslint-disable unicorn/consistent-function-scoping -- handler ref is local to the test for a `.toBe` identity check */
import { describe, expect, it } from "vitest";
import { createApi } from "../../api";
import { compileRoutes } from "../../builders/compile";
import { route } from "../../builders/route-builder";
import type { CompileInput, RouterState } from "../../types";

/** Standard compile input used across the manifest/entries scenarios. */
function makeInput(routes: CompileInput["routes"]): CompileInput {
  return {
    routes,
    mode: "hybrid",
    baseUrl: "https://blog.dev",
    locales: ["en", "uk"],
    defaultLocale: "en"
  };
}

/** Build an api over a compiled table from the given declaration-ordered routes. */
function makeApi(routes: CompileInput["routes"]) {
  const table = compileRoutes(makeInput(routes));
  const state: RouterState = { table };
  return createApi({ state });
}

describe("manifest()", () => {
  it("returns definitions in declaration order with handlers intact", () => {
    const load = (): { n: number } => ({ n: 1 });
    const api = makeApi({
      home: route("/"),
      article: route("/{slug}/").load(load),
      about: route("/about/")
    });
    const m = api.manifest();
    expect(m.map(d => d.pattern)).toEqual(["/", "/{slug}/", "/about/"]);
    expect(m[1]?._handlers.load).toBe(load);
  });

  it("returns a copy — mutating the returned array does not affect state", () => {
    const api = makeApi({ home: route("/"), about: route("/about/") });
    const first = api.manifest();
    (first as unknown[]).pop();
    expect(api.manifest()).toHaveLength(2);
  });
});

describe("entries()", () => {
  it("returns TypedRoute[] in specificity order (static before dynamic)", () => {
    const api = makeApi({ post: route("/{slug}/"), about: route("/about/") });
    const entries = api.entries();
    expect(entries[0]?.name).toBe("about");
    expect(entries.at(-1)?.name).toBe("post");
  });

  it("entries expose toUrl/toFile/match utilities", () => {
    const api = makeApi({ article: route("/{lang:?}/{slug}/") });
    const e = api.entries()[0];
    expect(e?.toUrl({ lang: "en", slug: "x" })).toBe("/en/x/");
    expect(e?.toFile({ lang: "en", slug: "x" })).toBe("en/x/index.html");
    expect(e?.match("/uk/y/")).toEqual({ lang: "uk", slug: "y" });
  });

  it("returns a copy — mutating the returned array does not affect state", () => {
    const api = makeApi({ post: route("/{slug}/"), about: route("/about/") });
    const first = api.entries();
    (first as unknown[]).pop();
    expect(api.entries()).toHaveLength(2);
  });
});

describe("match()", () => {
  it("returns route+params for the most specific match", () => {
    const api = makeApi({ post: route("/{slug}/"), about: route("/about/") });
    const hit = api.match("/about/");
    expect(hit?.params).toEqual({});
    expect(hit?.route.pattern).toBe("/about/");
  });

  it("returns null when nothing matches", () => {
    const api = makeApi({ about: route("/about/") });
    expect(api.match("/x/y/z/")).toBeNull();
  });
});

describe("toUrl()", () => {
  it("substitutes params for a named route", () => {
    const api = makeApi({ article: route("/{lang:?}/{slug}/") });
    expect(api.toUrl("article", { lang: "en", slug: "hi" })).toBe("/en/hi/");
  });

  it("throws on an unknown route name", () => {
    const api = makeApi({ home: route("/") });
    expect(() => api.toUrl("nope", {})).toThrow(/\[web\].*nope/s);
  });
});
