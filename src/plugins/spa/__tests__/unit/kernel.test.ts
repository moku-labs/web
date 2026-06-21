// @vitest-environment happy-dom
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api as HeadApi } from "../../../head/types";
import type { RouteDefinition, RouterApi } from "../../../router/types";
import { createSpaKernel, resolveSpaConfig } from "../../kernel";
import { createState } from "../../state";
import type { SpaKernelDeps, SpaState } from "../../types";

/** A router stub with the given mode + match result. */
function makeRouter(
  mode: "ssg" | "spa" | "hybrid",
  route?: RouteDefinition | undefined
): RouterApi {
  return {
    mode: () => mode,
    // eslint-disable-next-line unicorn/no-null -- RouterApi.match returns `... | null` on no match
    match: () => (route ? { params: { lang: "en" }, route } : null)
  } as unknown as RouterApi;
}

/** Minimal head API stub: `composeTitle` is a pass-through (no template), spy-able per test. */
function makeHead(composeTitle?: (head?: { title?: string }) => string): HeadApi {
  return {
    render: () => "",
    composeTitle: composeTitle ?? (head => head?.title ?? "")
  } as unknown as HeadApi;
}

/** Minimal stub deps — HTML-over-fetch only (no data reader). */
const deps: SpaKernelDeps = {
  router: makeRouter("hybrid"),
  head: makeHead()
};

/** A fresh kernel over fresh state with a spy emit. */
function setup(config = {}) {
  const state: SpaState = createState({ global: {}, config });
  const emit = vi.fn();
  const kernel = createSpaKernel(state, config, emit, deps);
  return { state, emit, kernel };
}

/** Options for a data-path kernel: the matched route, the raw data the reader returns, the mode. */
interface DataSetup {
  route?: RouteDefinition | undefined;
  raw?: unknown;
  mode?: "ssg" | "spa" | "hybrid";
  composeTitle?: (head?: { title?: string }) => string;
}

/** A kernel wired with the data reader enabled + the given matched route + raw payload. */
function setupData(options: DataSetup = {}) {
  const state: SpaState = createState({ global: {}, config: {} });
  const emit = vi.fn();
  const raw = "raw" in options ? options.raw : { title: "From Data" };
  const dataAt = vi.fn(() => Promise.resolve(raw));
  const deps: SpaKernelDeps = {
    router: makeRouter(options.mode ?? "hybrid", options.route),
    head: makeHead(options.composeTitle),
    dataAt
  };
  const kernel = createSpaKernel(state, {}, emit, deps);
  return { state, emit, kernel, dataAt };
}

/** A route whose `render` produces a known VNode from the fetched data (no `load` — data is fetched). */
function makeDataRoute(extra: Partial<RouteDefinition["_handlers"]> = {}): RouteDefinition {
  return {
    pattern: "/{lang:?}/{slug}/",
    _meta: {},
    _handlers: {
      render: (ctx: { data: unknown }) =>
        h("p", {}, `data:${(ctx.data as { title: string }).title}`),
      head: (ctx: { data: unknown }) => ({ title: (ctx.data as { title: string }).title }),
      ...extra
    }
  } as RouteDefinition;
}

/** A client-only route: dynamic (`/b/{id}/`), no `.generate()`, no `.load()`; render reads the URL param. */
function makeClientOnlyRoute(): RouteDefinition {
  return {
    pattern: "/b/{id}/",
    _meta: {},
    _handlers: {
      render: (ctx: { params: Record<string, string> }) =>
        h("p", {}, `board:${ctx.params.id ?? ""}`)
    }
  } as RouteDefinition;
}

/** A spa router stub that matches `/b/{id}/` with the given id and exposes mode "spa". */
function makeSpaRouter(route: RouteDefinition, id: string): RouterApi {
  return {
    mode: () => "spa",
    match: () => ({ params: { id }, route })
  } as unknown as RouterApi;
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
      islands: []
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
  it("registers config islands and seeds currentUrl", () => {
    const { state, kernel } = setup({ islands: [{ name: "c", hooks: {} }] });
    kernel.init();
    expect(state.registeredIslands.has("c")).toBe(true);
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

  it("falls back to a full browser navigation when the fetched page lacks the swap region", async () => {
    const { state, emit, kernel } = setup();
    kernel.init();
    const initialUrl = state.currentUrl;
    // A 200 page whose markup has no `main > section` — the region cannot be swapped.
    const html = `<html><head><title>Bare</title></head><body><div>no region here</div></body></html>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(html, { status: 200 })))
    );
    const hrefSetter = vi.fn();
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

    kernel.processNav("/bare");
    await vi.waitFor(() => expect(hrefSetter).toHaveBeenCalledWith("/bare"));

    // The old body is still rendered — the nav must NOT be reported as completed.
    expect(document.querySelector("#page")?.textContent).toBe("old");
    expect(state.currentUrl).toBe(initialUrl);
    expect(emit).not.toHaveBeenCalledWith("spa:navigated", expect.anything());
  });

  it("falls back to a full browser navigation when the live document lacks the swap region", async () => {
    const { state, emit, kernel } = setup();
    kernel.init();
    const initialUrl = state.currentUrl;
    // The live document has no `main > section` (e.g. the selector never matched this page).
    document.body.innerHTML = `<div>no region in the live document</div>`;
    const html = `<html><head><title>Next</title></head><body><main><section id="page">new</section></main></body></html>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(html, { status: 200 })))
    );
    const hrefSetter = vi.fn();
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

    kernel.processNav("/next");
    await vi.waitFor(() => expect(hrefSetter).toHaveBeenCalledWith("/next"));

    expect(state.currentUrl).toBe(initialUrl);
    expect(emit).not.toHaveBeenCalledWith("spa:navigated", expect.anything());
  });
});

describe("kernel.processNav — swap-time scroll (scroll-before-snapshot)", () => {
  it("forward nav scrolls to top INSTANT as part of the swap (VT OFF — never CSS smooth)", async () => {
    const { kernel } = setup(); // default config → viewTransitions: false
    kernel.init();
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const html = `<html><body><main><section id="page">new</section></main></body></html>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(html, { status: 200 })))
    );

    kernel.processNav("/about");
    await vi.waitFor(() => expect(document.querySelector("#page")?.textContent).toBe("new"));

    // Scroll happens in the swap (runSwap's beforeCapture), after the fetch. It is ALWAYS
    // `"instant"`, never CSS-driven `"auto"`: a smooth reset would still be animating when the
    // synchronous swap changes document height and get cancelled at the clamp point (worst on
    // WebKit), stranding the page near the old scroll position.
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });

  it("DATA-path forward nav also scrolls to top INSTANT in the swap", async () => {
    const { kernel } = setupData({ route: makeDataRoute(), raw: { title: "T" } });
    kernel.init();
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    kernel.processNav("/en/hello/");
    await vi.waitFor(() => expect(document.querySelector("#page")?.textContent).toBe("data:T"));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
    expect(fetchSpy).not.toHaveBeenCalled(); // DATA path, not HTML-over-fetch
  });

  it("forward nav scrolls INSTANT with view transitions ON too (keeps scrollY=0 in the snapshot)", async () => {
    const { kernel } = setup({ viewTransitions: true });
    kernel.init();
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const html = `<html><body><main><section id="page">new</section></main></body></html>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(html, { status: 200 })))
    );

    kernel.processNav("/about");
    await vi.waitFor(() => expect(document.querySelector("#page")?.textContent).toBe("new"));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
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
    document.body.innerHTML = `<main><section><div data-island="c"></div></section></main>`;
    kernel.scan();
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(state.instances.size).toBe(1);
    expect(emit).toHaveBeenCalledWith("spa:island-mount", expect.objectContaining({ name: "c" }));
  });
});

describe("island nav lifecycle during processNav", () => {
  it("fires onNavStart on nav begin and onNavEnd for persistent on complete", async () => {
    const order: string[] = [];
    const { state, kernel } = setup();
    kernel.init();
    // Persistent island lives OUTSIDE the swap region (in <header>).
    state.registeredIslands.set("nav", {
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
    document.body.innerHTML = `<header><div data-island="nav"></div></header><main><section id="page">old</section></main>`;
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

describe("kernel.processNav — client DATA path (data plugin composed)", () => {
  it("matches → fetches via dataAt → route.render into the swap region", async () => {
    const { state, emit, kernel, dataAt } = setupData({
      route: makeDataRoute(),
      raw: { title: "From Data" }
    });
    kernel.init();
    // No fetch stub: a fetch here would prove the HTML fallback wrongly ran.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    kernel.processNav("/en/hello/");
    await vi.waitFor(() =>
      expect(emit).toHaveBeenCalledWith("spa:navigated", { url: "/en/hello/" })
    );

    expect(dataAt).toHaveBeenCalledWith("/en/hello/");
    expect(document.querySelector("#page")?.textContent).toBe("data:From Data");
    expect(document.title).toBe("From Data");
    expect(state.currentUrl).toBe("/en/hello/");
    expect(fetchSpy).not.toHaveBeenCalled(); // DATA path, not HTML-over-fetch
  });

  it("announces the nav (spa:navigate) BEFORE awaiting the data fetch — feedback during the load", async () => {
    // A data reader that hangs until released, so we can observe the announce-vs-fetch order.
    let releaseData: ((value: unknown) => void) | undefined;
    const state: SpaState = createState({ global: {}, config: {} });
    const emit = vi.fn();
    const dataAt = vi.fn(
      () =>
        new Promise(resolve => {
          releaseData = resolve;
        })
    );
    const deps: SpaKernelDeps = {
      router: makeRouter("hybrid", makeDataRoute()),
      head: makeHead(),
      dataAt
    };
    const kernel = createSpaKernel(state, {}, emit, deps);
    kernel.init();
    const from = state.currentUrl;

    kernel.processNav("/en/hello/");

    // Synchronously after the click: the nav is announced (`spa:navigate`) and the data fetch is
    // already in flight — but it has NOT resolved, so no swap (`spa:navigated`) yet. That ordering
    // is the fix: the DATA path gives feedback DURING the network load, not only after it.
    expect(dataAt).toHaveBeenCalledWith("/en/hello/");
    expect(emit).toHaveBeenCalledWith("spa:navigate", { from, to: "/en/hello/" });
    expect(emit).not.toHaveBeenCalledWith("spa:navigated", expect.anything());

    // Release the data → the nav completes.
    releaseData?.({ title: "T" });
    await vi.waitFor(() =>
      expect(emit).toHaveBeenCalledWith("spa:navigated", { url: "/en/hello/" })
    );
  });

  it("DATA path resolves document.title through head.composeTitle (titleTemplate applied)", async () => {
    // The raw route title must NOT land in document.title — composeTitle owns the final value
    // (template applied; a route-pinned title element wins), matching the SSG <title> output.
    const composeTitle = vi.fn((head?: { title?: string }) => `${head?.title} — Site`);
    const { emit, kernel } = setupData({
      route: makeDataRoute(),
      raw: { title: "Page 2" },
      composeTitle
    });
    kernel.init();

    kernel.processNav("/en/page/");
    await vi.waitFor(() =>
      expect(emit).toHaveBeenCalledWith("spa:navigated", { url: "/en/page/" })
    );

    expect(composeTitle).toHaveBeenCalledWith({ title: "Page 2" });
    expect(document.title).toBe("Page 2 — Site");
  });

  it("falls back to HTML-over-fetch when route.render throws (no partial swap)", async () => {
    const { kernel } = setupData({
      route: makeDataRoute({
        render: () => {
          throw new Error("render failed");
        }
      })
    });
    kernel.init();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(`<main><section id="page">html fallback</section></main>`, { status: 200 })
        )
      )
    );

    kernel.processNav("/en/hello/");
    await vi.waitFor(() =>
      expect(document.querySelector("#page")?.textContent).toBe("html fallback")
    );
  });

  it("falls back to HTML-over-fetch when dataAt returns null (file missing)", async () => {
    // eslint-disable-next-line unicorn/no-null -- exercising the data-miss → fallback signal
    const { kernel } = setupData({ route: makeDataRoute(), raw: null });
    kernel.init();
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(`<main><section id="page">html</section></main>`, { status: 200 })
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    kernel.processNav("/en/hello/");
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  });

  it("falls back to HTML-over-fetch when no route matches", async () => {
    const { kernel } = setupData({ route: undefined });
    kernel.init();
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(`<main><section id="page">html</section></main>`, { status: 200 })
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    kernel.processNav("/unmatched/");
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  });

  it("does NOT use the DATA path when mode is ssg (HTML-over-fetch only)", async () => {
    const { kernel, dataAt } = setupData({ route: makeDataRoute(), mode: "ssg" });
    kernel.init();
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(`<main><section id="page">html</section></main>`, { status: 200 })
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    kernel.processNav("/en/hello/");
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/en/hello/"));
    expect(dataAt).not.toHaveBeenCalled(); // ssg mode skips the data path entirely
  });

  it("does NOT use the DATA path when no data reader is composed (HTML-over-fetch only)", async () => {
    const { kernel } = setup(); // default deps: no dataAt
    kernel.init();
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(`<main><section id="page">html</section></main>`, { status: 200 })
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    kernel.processNav("/en/hello/");
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/en/hello/"));
  });
});

describe("kernel — spa client-only routes (dynamic, no .generate())", () => {
  it("NAVIGATION client-renders it from the URL with NO data plugin and NO fetch", async () => {
    // A client-only route has no static HTML and no data sidecar — HTML-over-fetch would 404. The
    // kernel must client-render the matched route's own component from the URL params, no data needed.
    const state: SpaState = createState({ global: {}, config: {} });
    const emit = vi.fn();
    const route = makeClientOnlyRoute();
    // NB: deps has NO `dataAt` — proves a client-only render needs neither the data plugin nor a sidecar.
    const clientDeps: SpaKernelDeps = { router: makeSpaRouter(route, "abc"), head: makeHead() };
    const kernel = createSpaKernel(state, {}, emit, clientDeps);
    kernel.init();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    kernel.processNav("/b/abc/");
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith("spa:navigated", { url: "/b/abc/" }));

    expect(document.querySelector("#page")?.textContent).toBe("board:abc");
    expect(fetchSpy).not.toHaveBeenCalled(); // neither HTML-over-fetch nor a sidecar fetch
    expect(state.currentUrl).toBe("/b/abc/");
  });

  it("passes the route's .meta() bag (+ params) to .render() on client nav", async () => {
    // The client-only route declares `.meta({ focus: "card" })`; the client render reads it off the
    // ctx, alongside the URL param. This closes the gap that lets a client-only route drive its render
    // from route metadata (its `.load()` data is `{}`). The build half lives in build/pages.test.ts.
    const route = {
      pattern: "/b/{id}/",
      _meta: { focus: "card" },
      _handlers: {
        render: (ctx: { params: Record<string, string>; meta: Record<string, unknown> }) =>
          h("p", {}, `focus:${String(ctx.meta.focus)}:${ctx.params.id ?? ""}`)
      }
    } as RouteDefinition;
    const state: SpaState = createState({ global: {}, config: {} });
    const emit = vi.fn();
    const clientDeps: SpaKernelDeps = { router: makeSpaRouter(route, "abc"), head: makeHead() };
    const kernel = createSpaKernel(state, {}, emit, clientDeps);
    kernel.init();
    vi.stubGlobal("fetch", vi.fn());

    kernel.processNav("/b/abc/");
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith("spa:navigated", { url: "/b/abc/" }));

    expect(document.querySelector("#page")?.textContent).toBe("focus:card:abc");
  });

  it("BOOT client-renders the matched client-only route (deep-link / refresh on a fallback shell)", async () => {
    // On a deep-link the host served a fallback shell whose body is NOT this route. boot() must
    // client-render the matched route from the URL instead of hydrating the fallback's body.
    document.body.innerHTML = `<main><section id="page">fallback-shell-body</section></main>`;
    const state: SpaState = createState({ global: {}, config: {} });
    const emit = vi.fn();
    const clientDeps: SpaKernelDeps = {
      router: makeSpaRouter(makeClientOnlyRoute(), "xyz"),
      head: makeHead()
    };
    const kernel = createSpaKernel(state, {}, emit, clientDeps);
    kernel.init();

    kernel.boot();
    await vi.waitFor(() => expect(document.querySelector("#page")?.textContent).toBe("board:xyz"));

    expect(state.started).toBe(true);
    kernel.dispose();
  });

  it("BOOT hydrates a NON-client-only route (pre-rendered body is kept, not re-rendered)", () => {
    // A static (or generated) route IS pre-rendered; boot must hydrate its served body, never replace it.
    document.body.innerHTML = `<main><section id="page">pre-rendered</section></main>`;
    const state: SpaState = createState({ global: {}, config: {} });
    const emit = vi.fn();
    const staticRoute = {
      pattern: "/",
      _meta: {},
      _handlers: { render: () => h("p", {}, "client-rendered") }
    } as RouteDefinition;
    const staticDeps: SpaKernelDeps = {
      router: {
        mode: () => "spa",
        match: () => ({ params: {}, route: staticRoute })
      } as unknown as RouterApi,
      head: makeHead()
    };
    const kernel = createSpaKernel(state, {}, emit, staticDeps);
    kernel.init();

    kernel.boot(); // hydrate path is synchronous — no client re-render
    expect(document.querySelector("#page")?.textContent).toBe("pre-rendered");
    kernel.dispose();
  });
});

describe("kernel navigation — superseded navigation (navEvent.signal)", () => {
  it("a DATA navigation superseded mid-fetch never swaps and never falls back", async () => {
    // A data reader that hangs until released — the abort lands while it is in flight.
    let releaseData: ((value: unknown) => void) | undefined;
    const state: SpaState = createState({ global: {}, config: {} });
    const emit = vi.fn();
    const dataDeps: SpaKernelDeps = {
      router: makeRouter("hybrid", makeDataRoute()),
      head: makeHead(),
      dataAt: vi.fn(
        () =>
          new Promise(resolve => {
            releaseData = resolve;
          })
      )
    };
    const kernel = createSpaKernel(state, {}, emit, dataDeps);
    kernel.init();

    // Pin the location (the router classifies the destination against location.origin).
    Object.defineProperty(globalThis, "location", {
      value: { origin: "http://localhost:3000", pathname: "/", search: "" },
      configurable: true
    });

    // Boot against a stubbed Navigation API to capture the kernel's injected navigate.
    let listener: ((e: unknown) => void) | undefined;
    vi.stubGlobal("navigation", {
      addEventListener: (_t: string, l: (e: unknown) => void) => {
        listener = l;
      },
      removeEventListener: vi.fn()
    });
    kernel.boot();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    // A navigation begins (data fetch in flight)…
    const controller = new AbortController();
    const intercept = vi.fn();
    listener?.({
      destination: { url: "http://localhost:3000/en/hello/" },
      canIntercept: true,
      hashChange: false,
      // eslint-disable-next-line unicorn/no-null -- mirrors the native NavigateEvent.downloadRequest shape
      downloadRequest: null,
      navigationType: "push",
      signal: controller.signal,
      intercept,
      scroll: vi.fn()
    });
    const options = intercept.mock.calls.at(0)?.at(0) as { handler: () => Promise<void> };
    const pending = options.handler();

    // …and is superseded (the browser aborts its signal) while the data fetch hangs.
    controller.abort();
    releaseData?.({ title: "Stale" });
    await pending;

    // The dead navigation swapped nothing, emitted nothing, and did NOT degrade to
    // the HTML-over-fetch fallback (that fetch would race the live navigation).
    expect(document.querySelector("#page")?.textContent).toBe("old");
    expect(emit).not.toHaveBeenCalledWith("spa:navigated", expect.anything());
    expect(fetchSpy).not.toHaveBeenCalled();

    kernel.dispose();
    vi.unstubAllGlobals();
  });
});
