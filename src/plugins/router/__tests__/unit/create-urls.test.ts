/**
 * @file Unit tests for `createUrls` — the pure, app-free URL builder. Proves it
 * resolves a route's path by name + params via pattern substitution with NO running
 * app, router instance, or i18n (the cycle-free replacement for the bindRouter hack).
 */
import { describe, expect, it } from "vitest";
import { createUrls, defineRoutes, route } from "../../index";

describe("createUrls — pure, app-free URL builder", () => {
  const routes = defineRoutes({
    home: route("/{lang:?}/"),
    article: route("/{lang:?}/{slug}/"),
    about: route("/about/")
  });

  it("builds a locale-prefixed home path", () => {
    expect(createUrls(routes).toUrl("home", { lang: "en" })).toBe("/en/");
  });

  it("substitutes multiple params (lang + slug)", () => {
    expect(createUrls(routes).toUrl("article", { lang: "en", slug: "hello" })).toBe("/en/hello/");
  });

  it("builds a static path with no params", () => {
    expect(createUrls(routes).toUrl("about")).toBe("/about/");
  });

  it("throws a [web] router error for an unknown route name", () => {
    const url = createUrls(routes);
    // Cast bypasses the compile-time name check to exercise the runtime guard.
    expect(() => url.toUrl("missing" as "home")).toThrow(
      /\[web\] router: unknown route name "missing"/
    );
  });

  it("needs no createApp — the same map yields a usable builder at module scope", () => {
    const url = createUrls(routes);
    expect(url.toUrl("home", { lang: "uk" })).toBe("/uk/");
    expect(url.toUrl("article", { lang: "uk", slug: "post" })).toBe("/uk/post/");
  });
});
