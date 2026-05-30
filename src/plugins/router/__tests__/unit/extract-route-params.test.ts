import { describe, expectTypeOf, it } from "vitest";
import type { ExtractRouteParams, Prettify } from "../../types";

/** Prettified extracted-params type for a pattern `P`. */
type Params<P extends string> = Prettify<ExtractRouteParams<P>>;

/** Produce a typed value of `T` for value-based `expectTypeOf` assertions. */
function asValue<T>(): T {
  return undefined as T;
}

describe("ExtractRouteParams<P> template-literal inference", () => {
  it("optional lang + required slug → { lang?: string; slug: string }", () => {
    expectTypeOf(asValue<Params<"/{lang:?}/{slug}/">>()).toEqualTypeOf<{
      lang?: string;
      slug: string;
    }>();
  });

  it("colon syntax /:lang/:slug/ → both required", () => {
    expectTypeOf(asValue<Params<"/:lang/:slug/">>()).toEqualTypeOf<{
      lang: string;
      slug: string;
    }>();
  });

  it("static-only /about/ → {}", () => {
    expectTypeOf(asValue<Params<"/about/">>()).toEqualTypeOf<Record<never, never>>();
  });

  it("mixed required + optional", () => {
    expectTypeOf(asValue<Params<"/{category}/{slug:?}/">>()).toEqualTypeOf<{
      category: string;
      slug?: string;
    }>();
  });

  it("optional-only → optional key", () => {
    expectTypeOf(asValue<Params<"/{slug:?}/">>()).toEqualTypeOf<{ slug?: string }>();
  });

  it("single required brace param", () => {
    expectTypeOf(asValue<Params<"/{slug}/">>()).toEqualTypeOf<{ slug: string }>();
  });

  it("root pattern / → {}", () => {
    expectTypeOf(asValue<Params<"/">>()).toEqualTypeOf<Record<never, never>>();
  });
});
