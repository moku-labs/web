// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIsland,
  extractPageData,
  notifyNavEnd,
  notifyNavStart,
  scanAndMount,
  unmountAll,
  unmountPageSpecific
} from "../../islands";
import { createState } from "../../state";
import type { SpaState } from "../../types";

/** Fresh empty spa state for each test. */
function freshState(): SpaState {
  return createState({ global: {}, config: {} });
}

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

describe("createIsland validation", () => {
  it("returns a IslandDef for valid name + hooks", () => {
    const def = createIsland("counter", { onMount() {} });
    expect(def).toEqual({ name: "counter", hooks: expect.any(Object) });
  });

  it("throws on an unknown hook key (typo like onMout)", () => {
    expect(() => createIsland("counter", { onMout() {} } as never)).toThrow(/unknown island hook/);
  });

  it("throws on an empty name", () => {
    expect(() => createIsland("", { onMount() {} })).toThrow(/non-empty string/);
  });

  it("throws when a hook value is not a function", () => {
    expect(() => createIsland("x", { onMount: 5 } as never)).toThrow(/must be a function/);
  });

  it("uses the [web] error prefix", () => {
    expect(() => createIsland("", {})).toThrow(/^\[web\]/);
  });
});

describe("createIsland spec form", () => {
  it("accepts the plugin-mirror spec keys without flagging them as unknown hooks", () => {
    const def = createIsland<{ n: number }, { bump(): void }>("c", {
      state: () => ({ n: 0 }),
      render: s => `<output>${s.n}</output>`,
      events: { "click [data-inc]": ctx => ctx.set(s => ({ n: s.n + 1 })) },
      api: ctx => ({ bump: () => ctx.set(s => ({ n: s.n + 1 })) }),
      onMount() {}
    });
    expect(def.name).toBe("c");
    expect(def.spec?.state).toBeTypeOf("function");
    expect(def.spec?.render).toBeTypeOf("function");
    expect(def.spec?.events).toBeTypeOf("object");
    expect(def.spec?.api).toBeTypeOf("function");
    expect(def.hooks.onMount).toBeTypeOf("function");
  });

  it("still throws on a typo'd hook alongside valid spec keys", () => {
    expect(() => createIsland("c", { state: () => ({}), onMout() {} } as never)).toThrow(
      /unknown island hook/
    );
  });

  it("throws when a spec extra has the wrong shape (state not a function)", () => {
    expect(() => createIsland("c", { state: 5 } as never)).toThrow(/must be a function/);
  });

  it("throws when an events handler is not a function", () => {
    expect(() => createIsland("c", { events: { click: 1 } } as never)).toThrow(
      /must be a function/
    );
  });

  it("omits the spec slot entirely for the legacy hooks-only form", () => {
    const def = createIsland("legacy", { onMount() {} });
    expect(def.spec).toBeUndefined();
  });
});

describe("extractPageData", () => {
  it("parses the inline script#__DATA__ payload", () => {
    document.body.innerHTML = `<script id="__DATA__" type="application/json">{"a":1}</script>`;
    expect(extractPageData(document)).toEqual({ a: 1 });
  });

  it("returns {} when absent or invalid", () => {
    expect(extractPageData(document)).toEqual({});
    document.body.innerHTML = `<script id="__DATA__">not json</script>`;
    expect(extractPageData(document)).toEqual({});
  });
});

describe("scanAndMount", () => {
  it("fires onCreate then onMount in order and emits spa:island-mount", () => {
    const order: string[] = [];
    const state = freshState();
    state.registeredIslands.set("c", {
      name: "c",
      hooks: {
        onCreate() {
          order.push("onCreate");
        },
        onMount() {
          order.push("onMount");
        }
      }
    });
    document.body.innerHTML = `<main><section><div data-island="c"></div></section></main>`;
    const emit = vi.fn();

    scanAndMount(state, emit, "main > section");

    expect(order).toEqual(["onCreate", "onMount"]);
    const el = document.querySelector("[data-island]");
    expect(emit).toHaveBeenCalledWith("spa:island-mount", { name: "c", el });
    expect(state.instances.size).toBe(1);
  });

  it("passes the matched route slice (params/meta/locale) to the island context", () => {
    const state = freshState();
    let seen: { params: unknown; meta: unknown; locale: string } | undefined;
    state.registeredIslands.set("c", {
      name: "c",
      hooks: {
        onMount(ctx) {
          seen = { params: ctx.params, meta: ctx.meta, locale: ctx.locale };
        }
      }
    });
    document.body.innerHTML = `<main><section><div data-island="c"></div></section></main>`;

    scanAndMount(state, vi.fn(), "main > section", {
      params: { id: "abc" },
      meta: { focus: "card" },
      locale: "en",
      url: () => "/board/abc"
    });

    expect(seen).toEqual({ params: { id: "abc" }, meta: { focus: "card" }, locale: "en" });
  });

  it("defaults to an empty route slice when none is passed (params/meta empty)", () => {
    const state = freshState();
    let seen: { params: unknown; meta: unknown } | undefined;
    state.registeredIslands.set("c", {
      name: "c",
      hooks: {
        onMount(ctx) {
          seen = { params: ctx.params, meta: ctx.meta };
        }
      }
    });
    document.body.innerHTML = `<main><section><div data-island="c"></div></section></main>`;

    scanAndMount(state, vi.fn(), "main > section");

    expect(seen).toEqual({ params: {}, meta: {} });
  });

  it("classifies elements outside the swap area as persistent", () => {
    const state = freshState();
    state.registeredIslands.set("nav", { name: "nav", hooks: {} });
    state.registeredIslands.set("page", { name: "page", hooks: {} });
    document.body.innerHTML = `<header><div data-island="nav"></div></header><main><section><div data-island="page"></div></section></main>`;
    scanAndMount(state, vi.fn(), "main > section");
    const navEl = document.querySelector('[data-island="nav"]') as Element;
    const pageEl = document.querySelector('[data-island="page"]') as Element;
    expect(state.instances.get(navEl)?.persistent).toBe(true);
    expect(state.instances.get(pageEl)?.persistent).toBe(false);
  });

  it("skips already-mounted elements and unregistered names", () => {
    const state = freshState();
    const onMount = vi.fn();
    state.registeredIslands.set("c", { name: "c", hooks: { onMount } });
    document.body.innerHTML = `<main><section><div data-island="c"></div><div data-island="missing"></div></section></main>`;
    scanAndMount(state, vi.fn(), "main > section");
    scanAndMount(state, vi.fn(), "main > section"); // second scan: no re-mount
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(state.instances.size).toBe(1);
  });
});

describe("unmountPageSpecific", () => {
  it("runs onUnMount then onDestroy, emits spa:island-unmount, keeps persistent", () => {
    const order: string[] = [];
    const state = freshState();
    state.registeredIslands.set("page", {
      name: "page",
      hooks: {
        onUnMount() {
          order.push("onUnMount");
        },
        onDestroy() {
          order.push("onDestroy");
        }
      }
    });
    state.registeredIslands.set("nav", { name: "nav", hooks: {} });
    document.body.innerHTML = `<header><div data-island="nav"></div></header><main><section><div data-island="page"></div></section></main>`;
    const emit = vi.fn();
    scanAndMount(state, vi.fn(), "main > section");

    unmountPageSpecific(state, emit);

    expect(order).toEqual(["onUnMount", "onDestroy"]);
    expect(emit).toHaveBeenCalledWith("spa:island-unmount", {
      name: "page",
      el: expect.any(Object)
    });
    // Persistent nav instance survives.
    expect([...state.instances.values()].some(i => i.def.name === "nav")).toBe(true);
    expect([...state.instances.values()].some(i => i.def.name === "page")).toBe(false);
  });
});

describe("unmountAll", () => {
  it("destroys persistent + page-specific instances and clears the map", () => {
    const state = freshState();
    const destroy = vi.fn();
    state.registeredIslands.set("nav", { name: "nav", hooks: { onDestroy: destroy } });
    document.body.innerHTML = `<header><div data-island="nav"></div></header><main><section></section></main>`;
    scanAndMount(state, vi.fn(), "main > section");
    const emit = vi.fn();

    unmountAll(state, emit);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(state.instances.size).toBe(0);
    expect(emit).toHaveBeenCalledWith(
      "spa:island-unmount",
      expect.objectContaining({ name: "nav" })
    );
  });
});

describe("scanAndMount without a swap area", () => {
  it("treats every matched element as persistent when the swap region is absent", () => {
    const state = freshState();
    state.registeredIslands.set("c", { name: "c", hooks: {} });
    document.body.innerHTML = `<div data-island="c"></div>`; // no `main > section`
    scanAndMount(state, vi.fn(), "main > section");
    const el = document.querySelector('[data-island="c"]') as Element;
    expect(state.instances.get(el)?.persistent).toBe(true);
  });
});

describe("nav notifications", () => {
  it("notifyNavStart fires onNavStart on all instances; notifyNavEnd only on persistent", () => {
    const order: string[] = [];
    const state = freshState();
    state.registeredIslands.set("nav", {
      name: "nav",
      hooks: {
        onNavStart() {
          order.push("nav:start");
        },
        onNavEnd() {
          order.push("nav:end");
        }
      }
    });
    state.registeredIslands.set("page", {
      name: "page",
      hooks: {
        onNavStart() {
          order.push("page:start");
        },
        onNavEnd() {
          order.push("page:end");
        }
      }
    });
    document.body.innerHTML = `<header><div data-island="nav"></div></header><main><section><div data-island="page"></div></section></main>`;
    scanAndMount(state, vi.fn(), "main > section");

    notifyNavStart(state);
    notifyNavEnd(state);

    expect(order).toContain("nav:start");
    expect(order).toContain("page:start"); // page-specific also gets onNavStart
    expect(order).toContain("nav:end"); // persistent gets onNavEnd
    expect(order).not.toContain("page:end"); // page-specific does NOT get onNavEnd
  });
});
