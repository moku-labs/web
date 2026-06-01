import { describe, expect, it } from "vitest";
import { compileRoutes } from "../../builders/compile";
import { route } from "../../builders/route-builder";
import { bySpecificity, compileClientMatcher, dynamicSegmentCount } from "../../iso-match";
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
});
