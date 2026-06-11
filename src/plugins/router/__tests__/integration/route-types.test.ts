/* eslint-disable unicorn/no-null -- render handler stubs return `null` (valid VNode) */
import { describe, expectTypeOf, it } from "vitest";
import { envPlugin } from "../../../env";
import { createUrls, defineRoutes, route } from "../../index";
import type {
  ClientRoute,
  HeadConfig,
  RouteContext,
  RouteDefinition,
  RouteState
} from "../../types";

describe("route call-site + build-consumption type proofs", () => {
  it("call-site: ctx.data in .render() equals .load()'s return type", () => {
    route("/{lang:?}/{slug}/")
      .load(ctx => ({ slug: ctx.params.slug, title: `Post ${ctx.params.slug}`, words: 100 }))
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

  it("createUrls.toUrl is typed to the route map's names and returns a string", () => {
    const routes = defineRoutes({
      home: route("/{lang:?}/"),
      article: route("/{lang:?}/{slug}/")
    });
    const url = createUrls(routes);
    expectTypeOf(url.toUrl).parameter(0).toEqualTypeOf<"home" | "article">();
    expectTypeOf(url.toUrl("home", { lang: "en" })).toBeString();
  });
});

describe("#7 consumer-facing type exports from router/types.ts", () => {
  it("RouteContext is exported and types a route-handler ctx", () => {
    expectTypeOf<RouteContext<RouteState<"/{slug}/", { title: string }>>>().toHaveProperty(
      "params"
    );
    expectTypeOf<RouteContext<RouteState<"/{slug}/", { title: string }>>["locale"]>().toBeString();
  });

  it("RouteState is exported and carries params + data", () => {
    expectTypeOf<RouteState>().toHaveProperty("params");
    expectTypeOf<RouteState>().toHaveProperty("data");
  });

  it("loader require resolves a core-plugin instance (typed, no cast)", () => {
    route("/{slug}/").load(ctx => {
      const env = ctx.require(envPlugin);
      expectTypeOf(env.get("ANY")).toEqualTypeOf<string | undefined>();
      expectTypeOf(env.require("ANY")).toBeString();
      return {};
    });
  });

  it("HeadConfig is exported and is the route-handler head return", () => {
    expectTypeOf<HeadConfig["title"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<HeadConfig["description"]>().toEqualTypeOf<string | undefined>();
  });

  it("ClientRoute is exported as the serializable client projection", () => {
    expectTypeOf<ClientRoute["pattern"]>().toBeString();
    expectTypeOf<ClientRoute["name"]>().toBeString();
    expectTypeOf<ClientRoute["meta"]>().toEqualTypeOf<Record<string, unknown>>();
  });
});
