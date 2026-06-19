import { describe, expect, it } from "vitest";
import { buildUrl, compileRoutes } from "../../builders/compile";
import { route } from "../../builders/route-builder";
import {
  bySpecificity,
  compileClientMatcher,
  dynamicSegmentCount,
  extractGroups,
  isClientOnlyRoute
} from "../../iso-match";
import type { CompileInput } from "../../types";

/** Standard compile input used across the iso-match scenarios. */
function makeInput(routes: CompileInput["routes"]): CompileInput {
  return {
    routes,
    mode: "hybrid",
    baseUrl: "https://blog.dev",
    locales: ["en", "uk"],
    defaultLocale: "en"
  };
}

describe("dynamicSegmentCount()", () => {
  it("counts brace placeholders", () => {
    expect(dynamicSegmentCount("/blog/{slug}/")).toBe(1);
    expect(dynamicSegmentCount("/{a}/{b}/")).toBe(2);
  });

  it("counts optional brace placeholders", () => {
    expect(dynamicSegmentCount("/{slug:?}/")).toBe(1);
  });

  it("counts colon placeholders", () => {
    expect(dynamicSegmentCount("/blog/:slug/")).toBe(1);
    expect(dynamicSegmentCount("/:a/:b/")).toBe(2);
  });

  it("excludes the optional {lang:?} segment (matches the compiled table)", () => {
    expect(dynamicSegmentCount("/{lang:?}/{slug}/")).toBe(1);
    expect(dynamicSegmentCount("/{lang:?}/")).toBe(0);
  });

  it("static-only patterns count zero", () => {
    expect(dynamicSegmentCount("/")).toBe(0);
    expect(dynamicSegmentCount("/about/")).toBe(0);
  });
});

/** A route shape for the isClientOnlyRoute predicate: pattern + only the `generate` handler presence. */
const r = (pattern: string, generate?: () => unknown[]) => ({
  pattern,
  _handlers: generate ? { generate } : {}
});

describe("isClientOnlyRoute()", () => {
  it("is true ONLY in spa mode for a dynamic route with no .generate()", () => {
    expect(isClientOnlyRoute("spa", r("/b/{id}/"))).toBe(true);
    expect(isClientOnlyRoute("spa", r("/:id/"))).toBe(true);
  });

  it("is false for a dynamic route that declares .generate() (it is pre-rendered)", () => {
    expect(
      isClientOnlyRoute(
        "spa",
        r("/b/{id}/", () => [{ id: "1" }])
      )
    ).toBe(false);
  });

  it("is false for a static route (it is pre-rendered)", () => {
    expect(isClientOnlyRoute("spa", r("/"))).toBe(false);
    expect(isClientOnlyRoute("spa", r("/about/"))).toBe(false);
  });

  it("excludes the optional {lang:?} segment — a lang-only route is not dynamic", () => {
    expect(isClientOnlyRoute("spa", r("/{lang:?}/"))).toBe(false);
  });

  it("is false outside spa mode (hybrid/ssg pre-render every route)", () => {
    expect(isClientOnlyRoute("hybrid", r("/b/{id}/"))).toBe(false);
    expect(isClientOnlyRoute("ssg", r("/b/{id}/"))).toBe(false);
  });
});

describe("bySpecificity()", () => {
  it("orders fewer dynamic segments first", () => {
    const list = [{ pattern: "/{a}/{b}/" }, { pattern: "/about/" }, { pattern: "/{a}/" }];
    expect(list.toSorted(bySpecificity).map(x => x.pattern)).toEqual([
      "/about/",
      "/{a}/",
      "/{a}/{b}/"
    ]);
  });

  it("treats equal specificity as a tie (stable, returns 0)", () => {
    expect(bySpecificity({ pattern: "/a/" }, { pattern: "/b/" })).toBe(0);
  });

  it("reproduces the existing compiled-table order for a fixture", () => {
    const table = compileRoutes(
      makeInput({
        deep: route("/{a}/{b}/"),
        about: route("/about/"),
        post: route("/{slug}/"),
        home: route("/")
      })
    );
    // The compiled table is the source of truth; the comparator must match it.
    const tableOrder = table.compiled.map(c => c.pattern);
    const isoOrder = table.compiled.map(c => ({ pattern: c.pattern })).toSorted(bySpecificity);
    expect(isoOrder.map(x => x.pattern)).toEqual(tableOrder);
  });
});

describe("compileClientMatcher()", () => {
  it("matches a static route to an empty param object", () => {
    const m = compileClientMatcher("/about/");
    expect(m("/about/")).toEqual({});
    expect(m("/other/")).toBeNull();
  });

  it("extracts a required dynamic segment", () => {
    const m = compileClientMatcher("/{slug}/");
    expect(m("/hello/")).toEqual({ slug: "hello" });
    expect(m("/")).toBeNull();
  });

  it("matches the optional lang prefix both with and without a locale", () => {
    const m = compileClientMatcher("/{lang:?}/{slug}/");
    expect(m("/en/hello/")).toEqual({ lang: "en", slug: "hello" });
    expect(m("/hello/")).toEqual({ slug: "hello" });
  });

  it("supports colon placeholders", () => {
    const m = compileClientMatcher("/:slug/");
    expect(m("/x/")).toEqual({ slug: "x" });
  });

  it("decodes percent-encoded segments (location.pathname is encoded)", () => {
    const m = compileClientMatcher("/{lang:?}/tags/{tag}/");
    expect(m("/uk/tags/c%23%20tips%20%26%20tricks/")).toEqual({
      lang: "uk",
      tag: "c# tips & tricks"
    });
  });
});

describe("extractGroups()", () => {
  it("drops numeric keys and undefined values", () => {
    expect(extractGroups({ slug: "hello", "0": "x", gone: undefined })).toEqual({
      slug: "hello"
    });
  });

  it("percent-decodes captured values so params round-trip with buildUrl", () => {
    expect(extractGroups({ tag: "a%20%26%20b" })).toEqual({ tag: "a & b" });
  });

  it("keeps a malformed escape raw instead of throwing (hand-typed '%' URL)", () => {
    expect(extractGroups({ slug: "100%" })).toEqual({ slug: "100%" });
  });
});

describe("URL round-trip (buildUrl → compileClientMatcher → params)", () => {
  it("round-trips spaces and '&' in a param value", () => {
    const pattern = "/{lang:?}/tags/{tag}/";
    const m = compileClientMatcher(pattern);
    const url = buildUrl(pattern, { lang: "uk", tag: "c# tips & tricks" });
    expect(m(url)).toEqual({ lang: "uk", tag: "c# tips & tricks" });
  });
});
