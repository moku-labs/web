import { describe, expect, it } from "vitest";
import { buildFilePath, buildUrl, compileRoutes } from "../../builders/compile";
import { route } from "../../builders/route-builder";
import { dynamicSegmentCount } from "../../iso-match";
import type { CompileInput } from "../../types";

/** Standard compile input used across the to-url scenarios. */
function makeInput(routes: CompileInput["routes"]): CompileInput {
  return {
    routes,
    mode: "hybrid",
    baseUrl: "https://blog.dev",
    locales: ["en", "uk"],
    defaultLocale: "en"
  };
}

describe("buildUrl()", () => {
  it("substitutes a required {param}", () => {
    expect(buildUrl("/{slug}/", { slug: "hello" })).toBe("/hello/");
  });

  it("substitutes an optional {param:?}", () => {
    expect(buildUrl("/{lang:?}/{slug}/", { lang: "uk", slug: "x" })).toBe("/uk/x/");
  });

  it("skips an absent optional segment instead of leaving a double slash", () => {
    expect(buildUrl("/{lang:?}/{slug}/", { slug: "hello" })).toBe("/hello/");
  });

  it("keeps the optional segment when its param is present", () => {
    expect(buildUrl("/{lang:?}/{slug}/", { lang: "en", slug: "hello" })).toBe("/en/hello/");
  });

  it("leaves a static pattern untouched", () => {
    expect(buildUrl("/about/", {})).toBe("/about/");
  });
});

describe("buildFilePath()", () => {
  it("produces an index.html output path", () => {
    expect(buildFilePath("/{slug}/", { slug: "hello" })).toBe("hello/index.html");
  });

  it("handles the root pattern", () => {
    expect(buildFilePath("/", {})).toBe("index.html");
  });
});

describe("dynamicSegmentCount()", () => {
  it("ignores the optional lang segment", () => {
    expect(dynamicSegmentCount("/{lang:?}/{slug}/")).toBe(1);
  });

  it("counts required brace params", () => {
    expect(dynamicSegmentCount("/{a}/{b}/")).toBe(2);
  });

  it("static pattern is zero", () => {
    expect(dynamicSegmentCount("/about/")).toBe(0);
  });
});

describe("compiled toUrl via byName", () => {
  it("byName.toUrl substitutes params for a named route", () => {
    const table = compileRoutes(makeInput({ article: route("/{lang:?}/{slug}/") }));
    expect(table.byName.get("article")?.toUrl({ lang: "en", slug: "hello" })).toBe("/en/hello/");
  });

  it("toFile builds the output path", () => {
    const table = compileRoutes(makeInput({ post: route("/{slug}/") }));
    expect(table.byName.get("post")?.toFile({ slug: "hi" })).toBe("hi/index.html");
  });

  it("toFile honors a custom .toFile() override over the pattern default", () => {
    const feed = route("/feed/").toFile(() => "feed.xml");
    const table = compileRoutes(makeInput({ feed }));
    expect(table.byName.get("feed")?.toFile({})).toBe("feed.xml");
  });
});
