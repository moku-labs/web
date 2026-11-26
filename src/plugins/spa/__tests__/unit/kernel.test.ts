// @vitest-environment happy-dom
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api as HeadApi } from "../../../head/types";
import type { RouteDefinition, RouterApi } from "../../../router/types";
import { createSpaKernel, resolveSpaConfig } from "../../kernel";
import { createState } from "../../state";
import type { SpaConfig, SpaKernel, SpaKernelDeps, SpaState } from "../../types";

/** happy-dom's own Location: several tests below swap `globalThis.location` for a stub. */
const happyLocation = globalThis.location;

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

/** Minimal head API stub: `render` emits the route's title (no template), spy-able per test. */
function makeHead(render?: (route: { head?: { title?: string } }) => string): HeadApi {
  return {
    render: render ?? (route => `<title>${route.head?.title ?? ""}</title>`)
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
  render?: (route: { head?: { title?: string } }) => string;
  config?: SpaConfig;
}

/** A component that throws while Preact renders it. */
function BrokenComponent(): never {
  throw new Error("render failed");
}

/** A kernel wired with the data reader enabled + the given matched route + raw payload. */
function setupData(options: DataSetup = {}) {
  const state: SpaState = createState({ global: {}, config: {} });
  const emit = vi.fn();
  const raw = "raw" in options ? options.raw : { title: "From Data" };
  const dataAt = vi.fn(() => Promise.resolve(raw));
  const deps: SpaKernelDeps = {
    router: makeRouter(options.mode ?? "hybrid", options.route),
    head: makeHead(options.render),
    dataAt
  };
  const kernel = createSpaKernel(state, options.config ?? {}, emit, deps);
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
      defaultTransition: "none",
      scrollRestoration: "top",
      progressBar: true,
      islands: [],
      prefetch: false
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

  // Bug: a stop during a view transition left the tap listener on, and the swallowed tap was replayed
  // on a link after the app was gone (a full page load nobody asked for).
  it("dispose during a view transition drops the swallowed tap: nothing is replayed", async () => {
    const html = `<main><section id="page"><a id="link" href="/next/">next</a></section></main>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(html, { status: 200 })))
    );
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    let endTransition!: () => void;
    const finished = new Promise<void>(resolve => {
      endTransition = resolve;
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => void) => {
        update();
        return { finished, ready: Promise.resolve() };
      }
    });
    const linkClicks = vi.fn();
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [document.querySelector("#link")]
    });
    const { emit, kernel } = setup({ viewTransitions: "crossfade" });
    kernel.init();
    kernel.processNav("/after/");
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith("spa:navigated", { url: "/after/" }));
    document.querySelector("#link")?.addEventListener("click", event => {
      event.preventDefault();
      linkClicks();
    });

    document.documentElement.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 })
    );
    kernel.dispose();
    endTransition();
    await finished;
    await new Promise(resolve => setTimeout(resolve, 0));
    Reflect.deleteProperty(document, "startViewTransition");
    Reflect.deleteProperty(document, "elementsFromPoint");
    expect(linkClicks).not.toHaveBeenCalled();
  });

  it("hardNavigate detaches the interceptor, then does a real location.assign", () => {
    const { state, kernel } = setup();
    kernel.init();
    kernel.boot();
    expect(state.destroyRouter).not.toBeNull(); // the click/Navigation interceptor is attached

    const original = globalThis.location;
    const assign = vi.fn();
    Object.defineProperty(globalThis, "location", {
      value: { assign, pathname: "/", search: "" },
      configurable: true
    });
    kernel.hardNavigate("/signin/");

    // The interceptor is removed FIRST (so the assign is a real load, not a swap), then assign runs.
    expect(state.destroyRouter).toBeNull();
    expect(assign).toHaveBeenCalledWith("/signin/");
    Object.defineProperty(globalThis, "location", { value: original, configurable: true });
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

  it("a DATA swap queued behind a running transition renders into the live region, not the replaced one", async () => {
    // Bug: an earlier HTML swap lands while this navigation waits for its transition, so the
    // region this navigation looked up is detached by the time its update runs. Rendering into it
    // leaves the page on the old navigation's content.
    const { emit, kernel } = setupData({
      route: makeDataRoute(),
      raw: { title: "From Data" },
      config: { viewTransitions: true }
    });
    kernel.init();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => void) => {
        // The earlier navigation's queued swap replaces the region first.
        const fresh = document.createElement("section");
        fresh.id = "page";
        document.querySelector("#page")?.replaceWith(fresh);
        update();
        return { finished: Promise.resolve(), ready: Promise.resolve() };
      }
    });

    kernel.processNav("/en/hello/");
    await vi.waitFor(() =>
      expect(emit).toHaveBeenCalledWith("spa:navigated", { url: "/en/hello/" })
    );
    Reflect.deleteProperty(document, "startViewTransition");
    expect(document.querySelector("#page")?.textContent).toBe("data:From Data");
  });

  it("a DATA render that throws inside a view transition reports the error and loads the page in full", async () => {
    // Bug: renderVNode clears the region, then the component throws. Inside startViewTransition the
    // error only rejects `finished`/`ready`, which runSwap swallows, and tryDataRender's catch has
    // already returned: the region stays empty (the black content area) and nothing is reported.
    const { kernel } = setupData({
      route: makeDataRoute({ render: () => h(BrokenComponent, {}) }),
      config: { viewTransitions: true }
    });
    kernel.init();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => void) => {
        // The browser runs the update itself: its throw only rejects the transition's promises.
        let finished: Promise<void>;
        try {
          update();
          finished = Promise.resolve();
        } catch (error) {
          finished = Promise.reject(error);
        }
        return { finished, ready: finished };
      }
    });
    const hrefSetter = vi.fn();
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: {
        pathname: "/",
        search: "",
        get href() {
          return "";
        },
        set href(v: string) {
          hrefSetter(v);
        }
      }
    });

    kernel.processNav("/en/hello/");
    await vi.waitFor(() => expect(hrefSetter).toHaveBeenCalledWith("/en/hello/"));
    Reflect.deleteProperty(document, "startViewTransition");
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "render failed" }));
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

  it("DATA path resolves document.title through head.render (titleTemplate applied)", async () => {
    // The raw route title must NOT land in document.title — render owns the final value
    // (template applied; a route-pinned title element wins), matching the SSG <title> output.
    const render = vi.fn(
      (route: { head?: { title?: string } }) => `<title>${route.head?.title} — Site</title>`
    );
    const { emit, kernel } = setupData({
      route: makeDataRoute(),
      raw: { title: "Page 2" },
      render
    });
    kernel.init();

    kernel.processNav("/en/page/");
    await vi.waitFor(() =>
      expect(emit).toHaveBeenCalledWith("spa:navigated", { url: "/en/page/" })
    );

    expect(render.mock.calls[0]?.[0].head).toEqual({ title: "Page 2" });
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
    // A programmatic navigation carries its abort signal, like an intercepted one.
    await vi.waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/en/hello/", { signal: expect.any(AbortSignal) })
    );
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
    // A programmatic navigation carries its abort signal, like an intercepted one.
    await vi.waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/en/hello/", { signal: expect.any(AbortSignal) })
    );
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

/** A stand-in IntersectionObserver; the returned `observe` spy is what the tests read. */
function stubObserver(): ReturnType<typeof vi.fn> {
  const observe = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = observe;
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
  return observe;
}

/** The `href` of every anchor handed to the observer, in order. */
function observedHrefs(observe: ReturnType<typeof vi.fn>): (string | null)[] {
  return observe.mock.calls.map(call => (call[0] as Element).getAttribute("href"));
}

/** Press the element the way a finger or a mouse button does. */
function pointerdown(selector: string): void {
  document.querySelector(selector)?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
}

/** A route that matches but has no `render`: navigation to it always fetches HTML. */
const routeWithoutRender = { pattern: "/x/", _meta: {}, _handlers: {} } as RouteDefinition;

/** One row of the HTML-path table: the deps a navigation sees, and the preloads one press makes. */
interface HtmlPathCase {
  name: string;
  router: RouterApi;
  dataAt: boolean;
  fetches: number;
}

const htmlPathCases: HtmlPathCase[] = [
  { name: "ssg mode", router: makeRouter("ssg", makeDataRoute()), dataAt: true, fetches: 1 },
  {
    name: "a route with no render",
    router: makeRouter("hybrid", routeWithoutRender),
    dataAt: true,
    fetches: 1
  },
  {
    name: "a client-only route",
    router: makeSpaRouter(makeClientOnlyRoute(), "abc"),
    dataAt: false,
    fetches: 0
  },
  {
    name: "no data reader",
    router: makeRouter("hybrid", makeDataRoute()),
    dataAt: false,
    fetches: 1
  },
  { name: "a data reader", router: makeRouter("hybrid", makeDataRoute()), dataAt: true, fetches: 0 }
];

describe("kernel — prefetch", () => {
  const kernels: SpaKernel[] = [];

  /** Init and boot a kernel that `afterEach` disposes. */
  function boot(kernel: SpaKernel): SpaKernel {
    kernels.push(kernel);
    kernel.init();
    kernel.boot();
    return kernel;
  }

  beforeEach(() => {
    Object.defineProperty(globalThis, "location", { value: happyLocation, configurable: true });
    history.replaceState({}, "", "/");
    document.body.innerHTML = `<main><section id="page"><a id="link" href="/next/">next</a></section></main>`;
  });

  afterEach(() => {
    for (const kernel of kernels.splice(0)) kernel.dispose();
    Reflect.deleteProperty(document, "startViewTransition");
    vi.unstubAllGlobals();
  });

  // Bug: consumers who did not opt in get preload requests.
  it("the default boots no preloader; hover and pointerdown fetch nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { state, kernel } = setup();
    boot(kernel);

    expect(state.prefetch).toBeNull();
    document.querySelector("#link")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    pointerdown("#link");
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Bug: preload listeners stay on document after app.stop().
  it("dispose() drops the preloader and its listeners", () => {
    const fetchSpy = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchSpy);
    const { state, kernel } = setup({ prefetch: "intent" });
    boot(kernel);
    expect(state.prefetch).not.toBeNull();

    kernel.dispose();
    expect(state.prefetch).toBeNull();
    pointerdown("#link");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Bug: preload listeners keep fetching while the page unloads for a hard navigation.
  it("hardNavigate() drops the preloader and its listeners", () => {
    const fetchSpy = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchSpy);
    const { state, kernel } = setup({ prefetch: "intent" });
    boot(kernel);

    const assign = vi.fn();
    Object.defineProperty(globalThis, "location", {
      value: { assign, origin: happyLocation.origin, pathname: "/", search: "" },
      configurable: true
    });
    kernel.hardNavigate("/signin/");
    Object.defineProperty(globalThis, "location", { value: happyLocation, configurable: true });

    expect(assign).toHaveBeenCalledWith("/signin/");
    expect(state.prefetch).toBeNull();
    pointerdown("#link");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Bug: the navigation ignores the preload and fetches the page a second time.
  it("a navigation after pointerdown swaps the preloaded page with one fetch", async () => {
    const html = `<main><section id="page">next page</section></main>`;
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(html, { status: 200 })));
    vi.stubGlobal("fetch", fetchSpy);
    const { emit, kernel } = setup({ prefetch: "intent" });
    boot(kernel);

    pointerdown("#link");
    kernel.processNav("/next/");
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith("spa:navigated", { url: "/next/" }));
    expect(document.querySelector("#page")?.textContent).toBe("next page");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // Bug: HTML is preloaded for a route the DATA path renders, or not for one it cannot.
  it.each(htmlPathCases)("$name: one pointerdown makes $fetches preload(s)", ({
    router,
    dataAt,
    fetches
  }) => {
    document.body.innerHTML = `<header><a id="link" href="/b/xyz/">x</a></header><main><section id="page">old</section></main>`;
    const fetchSpy = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchSpy);
    const head = makeHead();
    const kernelDeps: SpaKernelDeps = dataAt
      ? { router, head, dataAt: vi.fn(() => Promise.resolve({})) }
      : { router, head };
    const state = createState({ global: {}, config: {} });
    boot(createSpaKernel(state, { prefetch: "intent" }, vi.fn(), kernelDeps));

    pointerdown("#link");
    expect(fetchSpy).toHaveBeenCalledTimes(fetches);
  });

  // Bug: with view transitions on, visible mode watches the old page's links instead of the new ones.
  it("visible + crossfade: boot watches the served links, a navigation the new page's links", async () => {
    const observe = stubObserver();
    const html = `<main><section id="page"><a id="after" href="/after/">after</a></section></main>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(html, { status: 200 })))
    );
    const startViewTransition = vi.fn((update: () => void) => {
      queueMicrotask(update);
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      value: startViewTransition,
      configurable: true
    });
    const { kernel } = setup({ prefetch: "visible", viewTransitions: "crossfade" });
    boot(kernel);
    expect(observedHrefs(observe)).toEqual(["/next/"]);

    kernel.processNav("/next/");
    await vi.waitFor(() => expect(observedHrefs(observe)).toContain("/after/"));
    expect(startViewTransition).toHaveBeenCalled();
  });

  // Bug: visible mode is dead after a navigation the DATA path rendered.
  it("visible: links on a DATA-rendered page reach the observer", async () => {
    const observe = stubObserver();
    const route = {
      pattern: "/{lang:?}/{slug}/",
      _meta: {},
      _handlers: { render: () => h("a", { href: "/rendered/" }, "rendered") }
    } as RouteDefinition;
    const router = {
      mode: () => "hybrid",
      match: (path: string) =>
        path === "/en/hello/" ? { params: { lang: "en" }, route } : undefined
    } as unknown as RouterApi;
    const emit = vi.fn();
    const dataAt = vi.fn(() => Promise.resolve({ title: "T" }));
    const state = createState({ global: {}, config: {} });
    const kernel = boot(
      createSpaKernel(state, { prefetch: "visible" }, emit, { router, head: makeHead(), dataAt })
    );

    kernel.processNav("/en/hello/");
    await vi.waitFor(() =>
      expect(emit).toHaveBeenCalledWith("spa:navigated", { url: "/en/hello/" })
    );
    expect(document.querySelector("#page")?.textContent).toBe("rendered");
    expect(observedHrefs(observe)).toContain("/rendered/");
  });

  // Bug: visible mode is dead on a deep-linked client-only page (rendered at boot, or, without a
  // swap region in the served shell, mounted as served).
  it.each([
    {
      name: "rendered into the swap region",
      body: `<main><section id="page">shell</section></main>`
    },
    { name: "served without a swap region", body: `<header><a href="/elsewhere/">x</a></header>` }
  ])("visible: links on a client-only page $name at boot reach the observer", async ({ body }) => {
    document.body.innerHTML = body;
    const observe = stubObserver();
    const route = {
      pattern: "/b/{id}/",
      _meta: {},
      _handlers: { render: () => h("a", { href: "/elsewhere/" }, "elsewhere") }
    } as RouteDefinition;
    const router = {
      mode: () => "spa",
      match: (path: string) =>
        path.startsWith("/b/") ? { params: { id: "abc" }, route } : undefined
    } as unknown as RouterApi;
    history.replaceState({}, "", "/b/abc/");
    const state = createState({ global: {}, config: {} });
    boot(createSpaKernel(state, { prefetch: "visible" }, vi.fn(), { router, head: makeHead() }));

    await vi.waitFor(() => expect(observedHrefs(observe)).toContain("/elsewhere/"));
  });
});

describe("kernel.updateUrl — moves the address within one route, no navigation", () => {
  const watch = { pattern: "/watch/{id}/{ep}/", _meta: {}, _handlers: {} } as RouteDefinition;
  const about = { pattern: "/about/", _meta: {}, _handlers: {} } as RouteDefinition;

  /** A router that matches `/watch/{id}/{ep}/` and `/about/` by path. */
  const router = {
    mode: () => "hybrid",
    match: (path: string) => {
      const [, id, ep] = /^\/watch\/([^/]+)\/([^/]+)\/$/.exec(path) ?? [];
      if (id && ep) return { params: { id, ep }, route: watch };
      // eslint-disable-next-line unicorn/no-null -- RouterApi.match returns `... | null` on no match
      return path === "/about/" ? { params: {}, route: about } : null;
    },
    toUrl: () => ""
  } as unknown as RouterApi;

  /** A kernel on `/watch/a/1/` with spies on both history writers. */
  function setupWatch() {
    history.replaceState({}, "", "/watch/a/1/");
    const state: SpaState = createState({ global: {}, config: {} });
    const emit = vi.fn();
    const kernel = createSpaKernel(state, {}, emit, { router, head: makeHead() });
    kernel.init();
    const replaceState = vi.spyOn(history, "replaceState");
    const pushState = vi.spyOn(history, "pushState");
    return { state, emit, kernel, replaceState, pushState };
  }

  it("replaces the history entry once, never pushes, and follows currentUrl", () => {
    const { state, kernel, replaceState, pushState } = setupWatch();

    kernel.updateUrl("/watch/a/2/");

    expect(replaceState).toHaveBeenCalledOnce();
    expect(replaceState).toHaveBeenCalledWith(history.state, "", "/watch/a/2/");
    expect(pushState).not.toHaveBeenCalled();
    expect(state.currentUrl).toBe("/watch/a/2/");
    expect(location.pathname).toBe("/watch/a/2/");
  });

  it("emits spa:url once with the new url, and no navigation event", () => {
    const { emit, kernel } = setupWatch();

    kernel.updateUrl("/watch/a/2/");

    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith("spa:url", { url: "/watch/a/2/" });
  });

  it("is a no-op for the current path", () => {
    const { emit, kernel, replaceState } = setupWatch();

    kernel.updateUrl("/watch/a/1/");

    expect(replaceState).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("throws a [web] error for a path of another route", () => {
    const { state, kernel, replaceState } = setupWatch();

    expect(() => kernel.updateUrl("/about/")).toThrow(
      '[web] spa.updateUrl: "/about/" is another route.\n  Use navigate() to change routes.'
    );
    expect(replaceState).not.toHaveBeenCalled();
    expect(state.currentUrl).toBe("/watch/a/1/");
  });

  it("sets the route slice of mounted islands and leaves their data alone", () => {
    const { state, kernel } = setupWatch();
    state.registeredIslands.set("player", { name: "player", hooks: {} });
    document.body.innerHTML = `<header><div data-island="player"></div></header><main><section id="page"></section></main>`;
    kernel.scan();
    const [instance] = state.instances.values();
    const data = { kept: true };
    if (instance) instance.data = data;

    kernel.updateUrl("/watch/a/2/");

    expect(instance?.ctx.params).toEqual({ id: "a", ep: "2" });
    expect(instance?.data).toBe(data);
  });

  it("is a no-op without a DOM: no throw, no history call", () => {
    const { kernel, emit, replaceState } = setupWatch();
    const original = globalThis.document;
    // @ts-expect-error — simulate a headless environment.
    delete globalThis.document;

    expect(() => kernel.updateUrl("/watch/a/2/")).not.toThrow();
    globalThis.document = original;
    expect(replaceState).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
