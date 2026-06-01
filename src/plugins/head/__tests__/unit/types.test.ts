import { describe, expectTypeOf, it } from "vitest";
import type {
  Api,
  ArticleMeta,
  Config,
  HeadConfig,
  HeadDefaults,
  HeadElement,
  ResolvedRoute,
  State
} from "../../types";

describe("head public type surface (#7)", () => {
  it("exports the full public type set from types.ts", () => {
    // Compile-level proof that every advertised public type is importable.
    expectTypeOf<Config>().not.toBeNever();
    expectTypeOf<State>().not.toBeNever();
    expectTypeOf<HeadDefaults>().not.toBeNever();
    expectTypeOf<HeadElement>().not.toBeNever();
    expectTypeOf<HeadConfig>().not.toBeNever();
    expectTypeOf<ArticleMeta>().not.toBeNever();
    expectTypeOf<ResolvedRoute>().not.toBeNever();
    expectTypeOf<Api>().not.toBeNever();
  });

  it("Head.HeadConfig has the resolved title/description/canonical/image/elements shape", () => {
    expectTypeOf<HeadConfig>().toEqualTypeOf<{
      title?: string;
      description?: string;
      canonical?: string;
      image?: string;
      elements?: HeadElement[];
    }>();
    expectTypeOf<HeadConfig["title"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<HeadConfig["elements"]>().toEqualTypeOf<HeadElement[] | undefined>();
  });

  it("Head.ResolvedRoute carries path/name/params plus optional locale and its HeadConfig", () => {
    expectTypeOf<ResolvedRoute["path"]>().toBeString();
    expectTypeOf<ResolvedRoute["name"]>().toBeString();
    expectTypeOf<ResolvedRoute["params"]>().toEqualTypeOf<Record<string, string>>();
    expectTypeOf<ResolvedRoute["locale"]>().toEqualTypeOf<string | undefined>();
    // ResolvedRoute.head is head's OWN (resolved) HeadConfig, not router's minimal one.
    expectTypeOf<ResolvedRoute["head"]>().toEqualTypeOf<HeadConfig | undefined>();
  });

  it("a consumer-shaped value satisfies Head.HeadConfig", () => {
    const head: HeadConfig = {
      title: "Home",
      description: "Welcome",
      canonical: "https://example.com/",
      image: "https://example.com/og.png",
      elements: [{ tag: "meta", attrs: { name: "robots", content: "index" } }]
    };
    expectTypeOf(head).toEqualTypeOf<HeadConfig>();
  });
});
