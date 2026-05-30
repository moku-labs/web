import { describe, expect, it } from "vitest";
import { compileRoutes } from "../../builders/compile";
import { createMatchFunction, extractParams, matchRoute } from "../../builders/match";
import { route } from "../../builders/route-builder";
import type { CompileInput } from "../../types";

/** Standard compile input used across the match scenarios. */
function makeInput(routes: CompileInput["routes"]): CompileInput {
  return {
    routes,
    mode: "hybrid",
    baseUrl: "https://blog.dev",
    locales: ["en", "uk"],
    defaultLocale: "en"
  };
}

describe("extractParams()", () => {
  it("strips numeric/regex group keys", () => {
    expect(extractParams({ slug: "hello", "0": "x", lang: "en" })).toEqual({
      slug: "hello",
      lang: "en"
    });
  });

  it("drops undefined group values", () => {
    expect(extractParams({ slug: "hello", lang: undefined })).toEqual({ slug: "hello" });
  });
});

describe("createMatchFunction()", () => {
  it("matches withLang first, returning the matched locale", () => {
    const table = compileRoutes(makeInput({ article: route("/{lang:?}/{slug}/") }));
    const fn = table.compiled[0]?.matchFn;
    expect(fn?.("/uk/hello/")).toEqual({ lang: "uk", slug: "hello" });
  });

  it("falls back to bare and injects defaultLocale", () => {
    const table = compileRoutes(makeInput({ article: route("/{lang:?}/{slug}/") }));
    const fn = table.compiled[0]?.matchFn;
    expect(fn?.("/hello/")).toEqual({ lang: "en", slug: "hello" });
  });

  it("returns null on no match", () => {
    const m = createMatchFunction(
      {
        withLang: new URLPattern({ pathname: "/:lang(en|uk)/:slug" }),
        bare: new URLPattern({ pathname: "/:slug" })
      },
      "en"
    );
    expect(m("/a/b/c/d")).toBeNull();
  });
});

describe("matchRoute() specificity", () => {
  it("static route beats dynamic for the same path", () => {
    const table = compileRoutes(makeInput({ post: route("/{slug}/"), about: route("/about/") }));
    const hit = matchRoute(table.compiled, "/about/");
    expect(hit?.route).toBe(table.byName.get("about")?.definition);
  });

  it("fewer dynamic segments matches first", () => {
    const table = compileRoutes(makeInput({ deep: route("/{a}/{b}/"), shallow: route("/{a}/") }));
    // compiled must be specificity-sorted: shallow (1 dynamic) before deep (2).
    expect(table.compiled[0]?.name).toBe("shallow");
    expect(table.compiled.at(-1)?.name).toBe("deep");
  });

  it("matches a required dynamic segment and extracts the param", () => {
    const table = compileRoutes(makeInput({ post: route("/{slug}/") }));
    const hit = matchRoute(table.compiled, "/my-post/");
    // No `{lang:?}` in the pattern → withLang variant matches first; lang is only
    // injected on the bare fallback of a lang-prefixed route.
    expect(hit?.params).toEqual({ slug: "my-post" });
  });

  it("returns null when nothing matches", () => {
    const table = compileRoutes(makeInput({ about: route("/about/") }));
    expect(matchRoute(table.compiled, "/nope/nope/nope/")).toBeNull();
  });

  it("optional lang matches both /en/x/ and /x/", () => {
    const table = compileRoutes(makeInput({ article: route("/{lang:?}/{slug}/") }));
    expect(matchRoute(table.compiled, "/en/x/")?.params).toEqual({ lang: "en", slug: "x" });
    expect(matchRoute(table.compiled, "/x/")?.params).toEqual({ lang: "en", slug: "x" });
  });
});
