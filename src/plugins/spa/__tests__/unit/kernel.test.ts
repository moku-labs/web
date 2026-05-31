// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api as HeadApi } from "../../../head/types";
import type { RouterApi } from "../../../router/types";
import { createSpaKernel, resolveSpaConfig } from "../../kernel";
import { createState } from "../../state";
import type { SpaKernelDeps, SpaState } from "../../types";

/** Minimal stub deps — the kernel only reuses these structurally in head-sync. */
const deps: SpaKernelDeps = {
  router: {} as RouterApi,
  head: { render: () => "" } as unknown as HeadApi
};

/** A fresh kernel over fresh state with a spy emit. */
function setup(config = {}) {
  const state: SpaState = createState({ global: {}, config });
  const emit = vi.fn();
  const kernel = createSpaKernel(state, config, emit, deps);
  return { state, emit, kernel };
}

beforeEach(() => {
  document.body.innerHTML = `<main><section id="page">old</section></main>`;
  document.head.innerHTML = "<title>Old</title>";
});

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

describe("resolveSpaConfig", () => {
  it("applies defaults for an empty config", () => {
    expect(resolveSpaConfig({})).toEqual({
      swapSelector: "main > section",
      viewTransitions: false,
      progressBar: true,
      components: [],
      clientData: "off",
      dataDir: "/_data/"
    });
  });

  it("preserves explicit values", () => {
    expect(
      resolveSpaConfig({ swapSelector: "#app", viewTransitions: true, progressBar: false })
    ).toMatchObject({
      swapSelector: "#app",
      viewTransitions: true,
      progressBar: false
    });
  });

  it("throws a [web] Part-3 error on an empty swapSelector", () => {
    expect(() => resolveSpaConfig({ swapSelector: "  " })).toThrow(/^\[web\] spa\.swapSelector/);
  });

  it("throws on a syntactically invalid swapSelector", () => {
    expect(() => resolveSpaConfig({ swapSelector: "main >>>" })).toThrow(
      /not a valid CSS selector/
    );
  });
});

describe("kernel.init", () => {
  it("registers config components and seeds currentUrl", () => {
    const { state, kernel } = setup({ components: [{ name: "c", hooks: {} }] });
    kernel.init();
    expect(state.registeredComponents.has("c")).toBe(true);
    expect(state.currentUrl).toBe(`${location.pathname}${location.search}`);
  });
});

describe("kernel.processNav", () => {
  it("fetches, swaps the region, updates currentUrl, and emits navigate then navigated", async () => {
    const { state, emit, kernel } = setup();
    kernel.init();
    const from = state.currentUrl;
    const html = `<html><head><title>About</title></head><body><main><section id="page">new content</section></main></body></html>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(html, { status: 200 })))
    );

    kernel.processNav("/about");
    await vi.waitFor(() => {
      expect(emit).toHaveBeenCalledWith("spa:navigated", { url: "/about" });
    });

    expect(document.querySelector("#page")?.textContent).toBe("new content");
    expect(document.title).toBe("About");
    expect(state.currentUrl).toBe("/about");
    const calls = emit.mock.calls.map(c => c[0]);
    expect(calls.indexOf("spa:navigate")).toBeLessThan(calls.indexOf("spa:navigated"));
    expect(emit).toHaveBeenCalledWith("spa:navigate", { from, to: "/about" });
  });

  it("falls back to a full browser navigation on fetch error", async () => {
    const { kernel } = setup();
    kernel.init();
    const hrefSetter = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network")))
    );
    Object.defineProperty(globalThis, "location", {
      value: {
        pathname: "/",
        search: "",
        get href() {
          return "";
        },
        set href(v: string) {
          hrefSetter(v);
        }
      },
      configurable: true
    });

    kernel.processNav("/broken");
    await vi.waitFor(() => expect(hrefSetter).toHaveBeenCalledWith("/broken"));
  });
});

describe("double-boot guard", () => {
  it("booting twice throws the [web] already-started error", () => {
    const { kernel } = setup();
    kernel.init();
    kernel.boot();
    expect(() => kernel.boot()).toThrow(/^\[web\] spa kernel already started/);
    kernel.dispose();
  });

  it("dispose resets started so a re-boot is allowed", () => {
    const { state, kernel } = setup();
    kernel.init();
    kernel.boot();
    expect(state.started).toBe(true);
    kernel.dispose();
    expect(state.started).toBe(false);
    expect(state.destroyRouter).toBeNull();
    expect(() => kernel.boot()).not.toThrow();
    kernel.dispose();
  });

  it("boot is a no-op without a DOM (typeof document guard)", () => {
    const { state, kernel } = setup();
    kernel.init();
    const original = globalThis.document;
    // @ts-expect-error — simulate a headless environment.
    delete globalThis.document;
    expect(() => kernel.boot()).not.toThrow();
    expect(state.started).toBe(false);
    globalThis.document = original;
  });
});

describe("kernel.register + scan", () => {
  it("register adds a definition that scan then mounts", () => {
    const { state, emit, kernel } = setup();
    const onMount = vi.fn();
    kernel.register({ name: "c", hooks: { onMount } });
    document.body.innerHTML = `<main><section><div data-component="c"></div></section></main>`;
    kernel.scan();
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(state.instances.size).toBe(1);
    expect(emit).toHaveBeenCalledWith(
      "spa:component-mount",
      expect.objectContaining({ name: "c" })
    );
  });
});

describe("component nav lifecycle during processNav", () => {
  it("fires onNavStart on nav begin and onNavEnd for persistent on complete", async () => {
    const order: string[] = [];
    const { state, kernel } = setup();
    kernel.init();
    // Persistent component lives OUTSIDE the swap region (in <header>).
    state.registeredComponents.set("nav", {
      name: "nav",
      hooks: {
        onNavStart() {
          order.push("onNavStart");
        },
        onNavEnd() {
          order.push("onNavEnd");
        }
      }
    });
    document.body.innerHTML = `<header><div data-component="nav"></div></header><main><section id="page">old</section></main>`;
    kernel.scan();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(`<main><section id="page">new</section></main>`, { status: 200 })
        )
      )
    );

    kernel.processNav("/next");
    await vi.waitFor(() => expect(order).toContain("onNavEnd"));
    expect(order).toEqual(["onNavStart", "onNavEnd"]);
  });
});
