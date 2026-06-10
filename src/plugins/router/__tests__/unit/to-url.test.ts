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

  it("keeps the optional segment when its param is present (no default locale given)", () => {
    expect(buildUrl("/{lang:?}/{slug}/", { lang: "en", slug: "hello" })).toBe("/en/hello/");
  });

  it("serves the default locale bare when one is given, others prefixed", () => {
    expect(buildUrl("/{lang:?}/{slug}/", { lang: "en", slug: "hello" }, "en")).toBe("/hello/");
    expect(buildUrl("/{lang:?}/", { lang: "en" }, "en")).toBe("/");
    expect(buildUrl("/{lang:?}/{slug}/", { lang: "uk", slug: "hello" }, "en")).toBe("/uk/hello/");
  });

  it("leaves a static pattern untouched", () => {
    expect(buildUrl("/about/", {})).toBe("/about/");
  });

  it("percent-encodes substituted values (space, &, #, ?)", () => {
    expect(buildUrl("/tags/{tag}/", { tag: "c# tips & tricks" })).toBe(
      "/tags/c%23%20tips%20%26%20tricks/"
    );
    expect(buildUrl("/{slug}/", { slug: "what?" })).toBe("/what%3F/");
  });

  it("does not encode static pattern segments", () => {
    expect(buildUrl("/tags/{tag}/", { tag: "x" })).toBe("/tags/x/");
  });
});

describe("buildFilePath()", () => {
  it("produces an index.html output path", () => {
    expect(buildFilePath("/{slug}/", { slug: "hello" })).toBe("hello/index.html");
  });

  it("handles the root pattern", () => {
    expect(buildFilePath("/", {})).toBe("index.html");
  });

  it("keeps param values literal (servers decode the request path before file lookup)", () => {
    expect(buildFilePath("/{lang:?}/tags/{tag}/", { lang: "uk", tag: "c# tips & tricks" })).toBe(
      "uk/tags/c# tips & tricks/index.html"
    );
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
  it("byName.toUrl serves the default locale bare, others prefixed", () => {
    const table = compileRoutes(makeInput({ article: route("/{lang:?}/{slug}/") }));
    const article = table.byName.get("article");
    expect(article?.toUrl({ lang: "en", slug: "hello" })).toBe("/hello/");
    expect(article?.toUrl({ lang: "uk", slug: "hello" })).toBe("/uk/hello/");
    expect(article?.toFile({ lang: "en", slug: "hello" })).toBe("hello/index.html");
    expect(article?.toFile({ lang: "uk", slug: "hello" })).toBe("uk/hello/index.html");
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

describe("URL round-trip (buildUrl → matchFn → params)", () => {
  it("round-trips params containing spaces and '&' through the compiled matcher", () => {
    const table = compileRoutes(makeInput({ tag: route("/{lang:?}/tags/{tag}/") }));
    const entry = table.byName.get("tag");
    const params = { lang: "uk", tag: "c# tips & tricks" };

    const url = entry?.toUrl(params) ?? "";
    expect(url).toBe("/uk/tags/c%23%20tips%20%26%20tricks/");
    expect(entry?.matchFn(url)).toEqual(params);
  });

  it("round-trips a default-locale bare URL back to the injected locale", () => {
    const table = compileRoutes(makeInput({ tag: route("/{lang:?}/tags/{tag}/") }));
    const entry = table.byName.get("tag");

    const url = entry?.toUrl({ lang: "en", tag: "a & b" }) ?? "";
    expect(url).toBe("/tags/a%20%26%20b/");
    expect(entry?.matchFn(url)).toEqual({ lang: "en", tag: "a & b" });
  });
});
