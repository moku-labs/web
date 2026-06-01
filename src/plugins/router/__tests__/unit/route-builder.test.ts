/* eslint-disable unicorn/no-null -- VNode handler stubs return `null`; renderers may legitimately return null */
/* eslint-disable unicorn/consistent-function-scoping -- handler refs are intentionally local to each test for `.toBe` identity checks */
import { describe, expect, expectTypeOf, it } from "vitest";
import { defineRoutes, route } from "../../builders/route-builder";
import type { RouteDefinition } from "../../types";

describe("route() fluent builder", () => {
  it("records the pattern on the returned definition", () => {
    const r = route("/{lang:?}/{slug}/");
    expect(r.pattern).toBe("/{lang:?}/{slug}/");
  });

  it("every chain method returns a chainable builder", () => {
    const r = route("/{slug}/");
    expect(r.load(() => ({ title: "x" }))).toBe(r);
    expect(r.layout(children => children as never)).toBe(r);
    expect(r.render(() => null as never)).toBe(r);
    expect(r.head(() => ({ title: "t" }))).toBe(r);
    expect(r.generate(() => [])).toBe(r);
    expect(r.meta({ activeTab: "blog" })).toBe(r);
    expect(r.toJson(() => ({}))).toBe(r);
    expect(r.toFile(() => "x.html")).toBe(r);
    expect(r.parse(raw => raw as { title: string })).toBe(r);
  });

  it("captures the .parse() validator and types it as the loaded data", () => {
    const parse = (raw: unknown): { title: string } => raw as { title: string };
    const r = route("/{slug}/")
      .load(() => ({ title: "hi" }))
      .parse(parse);
    expect(r._handlers.parse).toBe(parse);
  });

  it("parse must return the loaded data type (compile-time gate)", () => {
    const r = route("/{slug}/")
      .load(() => ({ title: "hi" }))
      // @ts-expect-error — parse must return { title: string }, not a number
      .parse(() => 123);
    expect(r._handlers.parse).toBeDefined();
  });

  it("captures handlers into the _handlers bag", () => {
    const load = (): { title: string } => ({ title: "hi" });
    const render = (): never => null as never;
    const head = (): { title: string } => ({ title: "h" });
    const generate = (): { slug: string }[] => [{ slug: "x" }];
    const r = route("/{slug}/").load(load).render(render).head(head).generate(generate);
    expect(r._handlers.load).toBe(load);
    expect(r._handlers.render).toBe(render);
    expect(r._handlers.head).toBe(head);
    expect(r._handlers.generate).toBe(generate);
  });

  it("accumulates metadata across .meta() calls", () => {
    const r = route("/about/").meta({ a: 1 }).meta({ b: 2 });
    expect(r._meta).toEqual({ a: 1, b: 2 });
  });

  it("captures toJson and toFile handlers", () => {
    const toJson = (): unknown => ({ ok: true });
    const toFile = (): string => "feed.xml";
    const r = route("/feed/").toJson(toJson).toFile(toFile);
    expect(r._handlers.toJson).toBe(toJson);
    expect(r._handlers.toFile).toBe(toFile);
  });

  it("a fresh route starts with empty handlers and meta", () => {
    const r = route("/x/");
    expect(r._handlers).toEqual({});
    expect(r._meta).toEqual({});
  });
});

describe("defineRoutes() identity helper", () => {
  it("returns the same object reference", () => {
    const map = { home: route("/"), article: route("/{slug}/") };
    expect(defineRoutes(map)).toBe(map);
  });
});

describe("route() / defineRoutes() type-level proofs", () => {
  it("a built route is assignable to RouteDefinition (RouteMap element)", () => {
    const r = route("/{slug}/").render(() => null as never);
    expectTypeOf(r).toExtend<RouteDefinition>();
  });

  it("ctx.data inside .render() equals .load()'s return type (call-site proof)", () => {
    route("/{slug}/")
      .load(() => ({ title: "x", views: 3 }))
      .render(ctx => {
        expectTypeOf(ctx.data).toEqualTypeOf<{ title: string; views: number }>();
        expectTypeOf(ctx.params).toExtend<{ slug: string }>();
        expectTypeOf(ctx.locale).toBeString();
        return null as never;
      });
  });

  it("ctx.data in .head() equals .load()'s awaited return type", () => {
    route("/{slug}/")
      .load(async () => ({ title: "from-promise" }))
      .head(ctx => {
        expectTypeOf(ctx.data).toEqualTypeOf<{ title: string }>();
        return { title: ctx.data.title };
      });
  });

  it("a loader receives params typed from the pattern", () => {
    route("/{lang:?}/{slug}/").load(params => {
      expectTypeOf(params).toExtend<{ slug: string; lang?: string }>();
      return { ok: true };
    });
  });
});
