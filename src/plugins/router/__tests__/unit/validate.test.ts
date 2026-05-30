import { describe, expect, it } from "vitest";
import { validateRoutes } from "../../builders/compile";
import { route } from "../../builders/route-builder";

describe("validateRoutes()", () => {
  it("accepts a non-empty, well-formed route map", () => {
    expect(() => validateRoutes({ home: route("/"), post: route("/{slug}/") })).not.toThrow();
  });

  it("throws on an empty route map", () => {
    expect(() => validateRoutes({})).toThrow(/\[web\].*empty|at least one/s);
  });

  it("throws on a pattern that does not start with /", () => {
    expect(() => validateRoutes({ bad: route("about/") })).toThrow(/\[web\].*bad/s);
  });

  it("throws on unbalanced braces", () => {
    expect(() => validateRoutes({ bad: route("/{slug/") })).toThrow(/\[web\].*bad/s);
  });

  it("throws on more than one optional lang segment", () => {
    expect(() => validateRoutes({ bad: route("/{lang:?}/{lang:?}/") })).toThrow(/\[web\].*bad/s);
  });
});
