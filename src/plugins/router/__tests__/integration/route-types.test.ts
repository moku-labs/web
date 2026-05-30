/* eslint-disable unicorn/no-null -- render handler stubs return `null` (valid VNode) */
import { describe, expectTypeOf, it } from "vitest";
import { defineRoutes, route } from "../../index";
import type { RouteDefinition } from "../../types";

describe("route call-site + build-consumption type proofs", () => {
  it("call-site: ctx.data in .render() equals .load()'s return type", () => {
    route("/{lang:?}/{slug}/")
      .load(({ slug }) => ({ slug, title: `Post ${slug}`, words: 100 }))
      .render(ctx => {
        expectTypeOf(ctx.data).toEqualTypeOf<{ slug: string; title: string; words: number }>();
        return null as never;
      })
      .head(ctx => {
        expectTypeOf(ctx.data.title).toBeString();
        return { title: ctx.data.title };
      });
  });

  it("build-consumption: defineRoutes preserves precise per-route literal types", () => {
    const routes = defineRoutes({
      home: route("/"),
      article: route("/{slug}/").load(() => ({ body: "x" }))
    });
    // The defineRoutes identity preserves the precise object type for IntelliSense.
    expectTypeOf(routes.home).toExtend<RouteDefinition>();
    expectTypeOf(routes.article).toExtend<RouteDefinition>();
    expectTypeOf(routes).toHaveProperty("article");
  });

  it("build-consumption: a route definition exposes _handlers for build", () => {
    const r = route("/{slug}/").load(() => ({ n: 1 }));
    expectTypeOf(r._handlers).toHaveProperty("load");
    expectTypeOf(r.pattern).toBeString();
    expectTypeOf(r._meta).toEqualTypeOf<Record<string, unknown>>();
  });
});
