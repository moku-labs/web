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
    expect(r.layout((_ctx, children) => children as never)).toBe(r);
    expect(r.render(() => null as never)).toBe(r);
    expect(r.head(() => ({ title: "t" }))).toBe(r);
    expect(r.generate(() => [])).toBe(r);
    expect(r.meta({ activeTab: "blog" })).toBe(r);
    expect(r.transition("slide")).toBe(r);
    expect(r.scroll("preserve")).toBe(r);
    expect(r.toJson(() => ({}))).toBe(r);
    expect(r.toFile(() => "x.html")).toBe(r);
  });

  it("captures .transition()/.scroll() as typed _transition/_scroll fields (not in _meta)", () => {
    const r = route("/board/{id}/issue/{issueId}")
      .transition("morph")
      .scroll("preserve")
      .meta({ focus: "issue" });
    expect(r._transition).toBe("morph");
    expect(r._scroll).toBe("preserve");
    // The directives are NOT smuggled into the free-form meta bag.
    expect(r._meta).toEqual({ focus: "issue" });
  });

  it("leaves _transition/_scroll undefined when not declared (app default applies)", () => {
    const r = route("/");
    expect(r._transition).toBeUndefined();
    expect(r._scroll).toBeUndefined();
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

  it("captures the ctx-aware layout wrapper into _handlers.layout", () => {
    const layout = (_ctx: unknown, children: unknown): never => children as never;
    const r = route("/").layout(layout);
    expect(r._handlers.layout).toBe(layout);
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

  it("the .layout() wrapper receives ctx (locale + meta + typed data) and children", () => {
    route("/{slug}/")
      .load(() => ({ title: "x" }))
      .layout((ctx, children) => {
        expectTypeOf(ctx.locale).toBeString();
        expectTypeOf(ctx.meta).toEqualTypeOf<Record<string, unknown>>();
        expectTypeOf(ctx.data).toEqualTypeOf<{ title: string }>();
        expectTypeOf(ctx.params).toExtend<{ slug: string }>();
        return children as never;
      });
  });

  it("a loader receives a ctx: params typed from the pattern, locale, and require/has", () => {
    route("/{lang:?}/{slug}/").load(ctx => {
      expectTypeOf(ctx.params).toExtend<{ slug: string; lang?: string }>();
      expectTypeOf(ctx.locale).toBeString();
      // Sibling plugin APIs come the spec way: ctx.require(pluginInstance).
      expectTypeOf(ctx.require).toBeFunction();
      expectTypeOf(ctx.has).toBeFunction();
      return { ok: true };
    });
  });

  it("the render/head ctx exposes url(name, params) for building links", () => {
    route("/{slug}/").render(ctx => {
      // `url` is delivered by the build/spa (backed by router.toUrl) — links with no app ref.
      expectTypeOf(ctx.url).toBeFunction();
      expectTypeOf(ctx.url("home")).toBeString();
      return null as never;
    });
  });
});
