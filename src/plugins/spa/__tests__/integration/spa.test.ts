// @vitest-environment happy-dom

import { logPlugin } from "@moku-labs/common";
import { createCoreConfig } from "@moku-labs/core";
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { dataPlugin } from "../../../data";
import { headPlugin } from "../../../head";
import { jsonLd, og } from "../../../head/primitives";
import { i18nPlugin } from "../../../i18n";
import { defineRoutes, route, routerPlugin } from "../../../router";
import { sitePlugin } from "../../../site";
import { spaPlugin } from "../../index";
import type { SpaApi, SpaConfig } from "../../types";

const SITE = {
  name: "SPA Test",
  url: "https://spa.dev",
  author: "Tester",
  description: "spa integration fixture"
};

/** Build the core (router+head+spa over happy-dom) exposing createPlugin for probes. */
function makeCore() {
  const coreConfig = createCoreConfig("web-test", {
    config: { stage: "production", mode: "spa" as const },
    plugins: [logPlugin],
    pluginConfigs: { log: { mode: "test" as const } }
  });
  return coreConfig.createCore(coreConfig, { plugins: [] });
}

/** Build a router+head+spa app over happy-dom (site+i18n satisfy head's deps). */
function makeApp(
  createApp: ReturnType<typeof makeCore>["createApp"],
  extraPlugins: unknown[] = [],
  spa: SpaConfig = {}
) {
  const routes = defineRoutes({
    home: route("/")
      .render(() => undefined as never)
      .head(() => ({ title: "Home" })),
    about: route("/about/")
      .render(() => undefined as never)
      .head(() => ({ title: "About" }))
  });
  const app = createApp({
    plugins: [
      sitePlugin,
      i18nPlugin,
      routerPlugin,
      headPlugin,
      spaPlugin,
      ...(extraPlugins as never[])
    ],
    pluginConfigs: {
      site: SITE,
      i18n: { locales: ["en"], defaultLocale: "en" },
      head: {},
      spa: { progressBar: false, ...spa },
      router: { routes }
    }
  });
  return app;
}

/** HTML returned by the mocked fetch for the navigated page. */
function pageHtml(title: string, body: string): string {
  return `<html><head><title>${title}</title></head><body><main><section id="page">${body}</section></main></body></html>`;
}

/** Runs an intercepted navigation's handler once the `navigate` event is done, like Chrome. */
function interceptLater(options: { handler: () => Promise<void> }): void {
  queueMicrotask(() => {
    options.handler().catch(() => {});
  });
}

/**
 * A `navigate` event for a push to `url`.
 *
 * @param url - The destination.
 * @returns The fake event.
 */
function pushEvent(url: string) {
  return {
    destination: { url: new URL(url, location.href).href },
    canIntercept: true,
    hashChange: false,
    // eslint-disable-next-line unicorn/no-null -- mirrors the native NavigateEvent.downloadRequest shape
    downloadRequest: null,
    navigationType: "push",
    signal: new AbortController().signal,
    intercept: interceptLater,
    scroll: vi.fn()
  };
}

/**
 * A Navigation API like Chrome's: `history.pushState` fires `navigate` for the new URL before the
 * URL changes.
 */
function stubChromeNavigation(): {
  traverse: (url: string) => void;
  push: (url: string) => void;
} {
  const listeners: Array<(event: unknown) => void> = [];
  vi.stubGlobal("navigation", {
    addEventListener: (_type: string, listener: (event: unknown) => void) =>
      listeners.push(listener),
    removeEventListener: vi.fn()
  });
  const push = History.prototype.pushState;
  vi.spyOn(history, "pushState").mockImplementation(function (this: History, data, unused, url) {
    for (const listener of listeners) listener(pushEvent(String(url)));
    push.call(this, data, unused, url);
  });
  const replace = History.prototype.replaceState;
  vi.spyOn(history, "replaceState").mockImplementation(function (this: History, data, unused, url) {
    for (const listener of listeners)
      listener({ ...pushEvent(String(url)), navigationType: "replace" });
    replace.call(this, data, unused, url);
  });
  return {
    traverse: url => {
      for (const listener of listeners) listener({ ...pushEvent(url), navigationType: "traverse" });
    },
    push: url => {
      for (const listener of listeners) listener(pushEvent(url));
    }
  };
}

/**
 * A promise the test resolves later, for a page that is still loading.
 *
 * @returns The promise and its resolver.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  const settlers: Array<(value: T) => void> = [];
  const promise = new Promise<T>(settle => {
    settlers.push(settle);
  });
  return { promise, resolve: value => settlers[0]?.(value) };
}

/** Read an attribute of the first live element matching a selector. */
function attribute(selector: string, name: string): string | null | undefined {
  return document.querySelector(selector)?.getAttribute(name);
}

let app: ReturnType<typeof makeApp>;

beforeEach(() => {
  document.body.innerHTML = `<main><section id="page">home</section></main>`;
  document.head.innerHTML = "<title>Home</title>";
});

afterEach(async () => {
  // Guard: the type-level test never starts the app (stop() on an unstarted app throws).
  await app?.stop().catch(() => {});
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("spa integration", () => {
  it("createApp(router+head+spa): start → navigate → stop full cycle", async () => {
    const { createApp } = makeCore();
    app = makeApp(createApp);
    await app.start();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(pageHtml("About", "about content"), { status: 200 }))
      )
    );

    app.spa.navigate("/about/");
    await vi.waitFor(() => expect(app.spa.current()).toBe("/about/"));

    expect(document.querySelector("#page")?.textContent).toBe("about content");
    expect(document.title).toBe("About");
  });

  it("emits spa:navigate then spa:navigated with correct payloads (probe via depends)", async () => {
    const { createApp, createPlugin } = makeCore();
    const seen: Array<{ event: string; payload: unknown }> = [];
    const probe = createPlugin("spa-probe", {
      depends: [spaPlugin],
      hooks: () => ({
        "spa:navigate": (payload: { from: string; to: string }) => {
          seen.push({ event: "spa:navigate", payload });
        },
        "spa:navigated": (payload: { url: string }) => {
          seen.push({ event: "spa:navigated", payload });
        }
      })
    });
    app = makeApp(createApp, [probe]);
    await app.start();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(pageHtml("About", "x"), { status: 200 })))
    );
    const from = app.spa.current();

    app.spa.navigate("/about/");
    await vi.waitFor(() => expect(seen.some(e => e.event === "spa:navigated")).toBe(true));

    const names = seen.map(e => e.event);
    expect(names.indexOf("spa:navigate")).toBeLessThan(names.indexOf("spa:navigated"));
    expect(seen.find(e => e.event === "spa:navigate")?.payload).toEqual({ from, to: "/about/" });
    expect(seen.find(e => e.event === "spa:navigated")?.payload).toEqual({ url: "/about/" });
    app.log.expect().toHaveEventInOrder([]); // log surface present (assertion chain available)
  });

  it("onStop removes listeners: a post-stop simulated click does nothing", async () => {
    const { createApp } = makeCore();
    app = makeApp(createApp);
    await app.start();
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(pageHtml("About", "x"), { status: 200 }))
    );
    vi.stubGlobal("fetch", fetchSpy);

    await app.stop();

    document.body.innerHTML = `<a id="link" href="https://spa.dev/about/">go</a>`;
    const link = document.querySelector("#link") as HTMLAnchorElement;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("client DATA path: composing dataPlugin fetches the page data and renders it directly", async () => {
    const { createApp } = makeCore();
    const routes = defineRoutes({
      home: route("/")
        .render(() => undefined as never)
        .head(() => ({ title: "Home" })),
      doc: route("/doc/")
        .load(() => ({ body: "from-data" }))
        .render(
          ctx =>
            h(
              "section",
              { id: "page" },
              `rendered:${(ctx.data as { body: string }).body}`
            ) as ReturnType<typeof h>
        )
        .head(() => ({ title: "Doc" }))
    });
    app = createApp({
      plugins: [sitePlugin, i18nPlugin, routerPlugin, headPlugin, spaPlugin, dataPlugin],
      pluginConfigs: {
        site: SITE,
        i18n: { locales: ["en"], defaultLocale: "en" },
        head: {},
        spa: { progressBar: false },
        router: { routes }
      }
    });
    await app.start();
    // The client fetches the PERSISTED page data (not an HTML page) via data.at →
    // the data URL. Serve it; assert the fetch targeted the data file, then render.
    const fetchSpy = vi.fn((url: string) => {
      expect(url).toBe("/_data/doc/index.json");
      return Promise.resolve(Response.json({ body: "from-data" }, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchSpy);

    app.spa.navigate("/doc/");
    await vi.waitFor(() => expect(app.spa.current()).toBe("/doc/"));

    expect(document.querySelector("#page")?.textContent).toBe("rendered:from-data");
    expect(document.title).toBe("Doc");
    expect(fetchSpy).toHaveBeenCalledWith("/_data/doc/index.json"); // data fetch, not HTML page
    // Programmatic navigation must commit the ADDRESS BAR too (not just the internal currentUrl) —
    // a link click / the Navigation API does this for the interceptor, but app.spa.navigate /
    // ctx.navigate bypass it, so the kernel pushState's itself. Else back/refresh/deep-link break.
    expect(location.pathname).toBe("/doc/");
  });

  it("client DATA path: syncs the whole head of the new page, not only the title", async () => {
    const { createApp } = makeCore();
    const routes = defineRoutes({
      home: route("/")
        .render(() => undefined as never)
        .head(() => ({ title: "Home" })),
      doc: route("/{lang:?}/doc/")
        .load(() => ({ body: "from-data" }))
        .render(() => h("section", { id: "page" }, "doc page") as ReturnType<typeof h>)
        .head(() => ({
          title: "Doc",
          description: "Doc description",
          image: "/doc.png",
          elements: [og("og:type", "article"), jsonLd({ name: "Doc" })]
        }))
    });
    app = createApp({
      plugins: [sitePlugin, i18nPlugin, routerPlugin, headPlugin, spaPlugin, dataPlugin],
      pluginConfigs: {
        site: SITE,
        i18n: { locales: ["en", "uk"], defaultLocale: "en" },
        head: { titleTemplate: "%s | Site" },
        spa: { progressBar: false },
        router: { routes }
      }
    });
    await app.start();
    document.head.innerHTML = `<title>Home</title><meta name="description" content="Home description"><link rel="canonical" href="https://spa.dev/"><meta property="og:url" content="https://spa.dev/"><meta property="og:type" content="website"><meta property="og:image" content="https://spa.dev/home.png"><script type="application/ld+json">{"name":"Home"}</script>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ body: "from-data" }, { status: 200 })))
    );

    app.spa.navigate("/uk/doc/");
    await vi.waitFor(() => expect(document.querySelector("#page")?.textContent).toBe("doc page"));

    expect(document.title).toBe("Doc | Site");
    expect(attribute('meta[name="description"]', "content")).toBe("Doc description");
    expect(attribute('link[rel="canonical"]', "href")).toBe("https://spa.dev/uk/doc/");
    expect(attribute('meta[property="og:url"]', "content")).toBe("https://spa.dev/uk/doc/");
    expect(attribute('link[hreflang="en"]', "href")).toBe("https://spa.dev/doc/");
    expect(document.documentElement.lang).toBe("uk");
    expect(attribute('meta[property="og:type"]', "content")).toBe("article");
    expect(attribute('meta[property="og:image"]', "content")).toBe("https://spa.dev/doc.png");
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    expect([...jsonLdScripts].map(script => script.textContent)).toEqual(['{"name":"Doc"}']);
  });

  it("a programmatic navigation runs once where pushState fires the Navigation API's navigate", async () => {
    stubChromeNavigation();
    const { createApp } = makeCore();
    app = makeApp(createApp);
    await app.start();
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(pageHtml("About", "about content"), { status: 200 }))
    );
    vi.stubGlobal("fetch", fetchSpy);

    app.spa.navigate("/about/");
    await vi.waitFor(() =>
      expect(document.querySelector("#page")?.textContent).toBe("about content")
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe("/about/");
    vi.unstubAllGlobals();
  });

  it("a back pressed while a programmatic navigation loads wins: the late page never swaps in", async () => {
    const navigation = stubChromeNavigation();
    const { createApp } = makeCore();
    app = makeApp(createApp);
    await app.start();
    const about = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.startsWith("/about")
          ? about.promise
          : Promise.resolve(new Response(pageHtml("Home", "home again"), { status: 200 }))
      )
    );

    app.spa.navigate("/about/");
    navigation.traverse("/");
    await vi.waitFor(() => expect(document.querySelector("#page")?.textContent).toBe("home again"));
    about.resolve(new Response(pageHtml("About", "about content"), { status: 200 }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.querySelector("#page")?.textContent).toBe("home again");
    expect(app.spa.current()).toBe("/");
    vi.unstubAllGlobals();
  });

  it("navigate with replace swaps the page in place of the history entry, once", async () => {
    stubChromeNavigation();
    const { createApp } = makeCore();
    app = makeApp(createApp);
    await app.start();
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(pageHtml("About", "about content"), { status: 200 }))
    );
    vi.stubGlobal("fetch", fetchSpy);
    const entries = history.length;

    app.spa.navigate("/replaced/", { replace: true });
    await vi.waitFor(() =>
      expect(document.querySelector("#page")?.textContent).toBe("about content")
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(history.replaceState).toHaveBeenCalledOnce();
    expect(history.pushState).not.toHaveBeenCalled();
    expect(history.length).toBe(entries);
    expect(location.pathname).toBe("/replaced/");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("type-level: app.spa is SpaApi with register/navigate/current", () => {
    const { createApp } = makeCore();
    app = makeApp(createApp);
    expectTypeOf(app.spa).toMatchTypeOf<SpaApi>();
    expectTypeOf(app.spa.navigate).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(app.spa.current).returns.toEqualTypeOf<string>();
    expectTypeOf(app.spa.register).parameter(0).toMatchTypeOf<{ name: string }>();
  });
});

/** A page with one internal link outside the swap region. */
const LINKED_PAGE = `<nav><a id="about" href="/about/">About</a></nav><main><section id="page">home</section></main>`;

/**
 * Stub `fetch` to serve the About page, a fresh response per call.
 *
 * @returns The spy that counts the page requests.
 */
function serveAbout() {
  const fetchSpy = vi.fn((_path: string, _init?: RequestInit) =>
    Promise.resolve(new Response(pageHtml("About", "about content"), { status: 200 }))
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

/**
 * Dispatch an event on the About link, the way the browser does under a tap or the mouse.
 *
 * @param type - The event type: `pointerdown`, `touchstart` or `mouseover`.
 */
function onLink(type: string): void {
  const link = document.querySelector("#about");
  if (!link) throw new Error("no #about link");
  const event =
    type === "mouseover"
      ? new MouseEvent(type, { bubbles: true })
      : new Event(type, { bubbles: true });
  link.dispatchEvent(event);
}

/** Click the About link (the History fallback intercepts it). */
function clickLink(): void {
  document
    .querySelector("#about")
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

/**
 * Wait longer than the 65 ms hover delay, so a hover preload would have started.
 *
 * @returns A promise that resolves after the wait.
 */
function pastHoverDelay(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 100));
}

/** Every IntersectionObserver built while the stub is on (emptied before each test). */
const observers: FakeObserver[] = [];

/** A stand-in IntersectionObserver that keeps the elements it watches. */
class FakeObserver {
  readonly observed = new Set<Element>();

  constructor() {
    observers.push(this);
  }

  /**
   * Watch an element.
   *
   * @param target - The element.
   */
  observe(target: Element): void {
    this.observed.add(target);
  }

  /**
   * Stop watching an element.
   *
   * @param target - The element.
   */
  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  /** Stop watching every element. */
  disconnect(): void {
    this.observed.clear();
  }
}

/**
 * Build a router+head+spa app with a probe that counts `spa:navigated`.
 *
 * @param spa - The spa config under test.
 * @returns The app and the list of navigated URLs.
 */
function makeProbedApp(spa: SpaConfig): { app: ReturnType<typeof makeApp>; navigated: string[] } {
  const { createApp, createPlugin } = makeCore();
  const navigated: string[] = [];
  const probe = createPlugin("spa-probe", {
    depends: [spaPlugin],
    hooks: () => ({
      "spa:navigated": (payload: { url: string }) => {
        navigated.push(payload.url);
      }
    })
  });
  return { app: makeApp(createApp, [probe], spa), navigated };
}

describe("spa prefetch integration", () => {
  beforeEach(() => {
    history.replaceState(undefined, "", "/");
    document.body.innerHTML = LINKED_PAGE;
    observers.length = 0;
  });

  afterEach(async () => {
    await app?.stop().catch(() => {});
    vi.unstubAllGlobals();
  });

  // Bug: the Navigation API path ignores the cache and fetches the page a second time on the tap.
  it('prefetch "intent", Navigation API: a pointerdown then the tap make one request', async () => {
    const navigation = stubChromeNavigation();
    const probed = makeProbedApp({ prefetch: "intent" });
    app = probed.app;
    await app.start();
    const fetchSpy = serveAbout();

    onLink("pointerdown");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    navigation.push("/about/"); // the browser's navigate event for the tap
    await vi.waitFor(() =>
      expect(document.querySelector("#page")?.textContent).toBe("about content")
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/about/");
    expect(document.title).toBe("About");
    expect(probed.navigated).toEqual(["/about/"]);
  });

  // Bug: the History fallback (no Navigation API) skips the cache and fetches the page again.
  it('prefetch "intent", History fallback: a pointerdown then the click make one request', async () => {
    vi.stubGlobal("navigation", undefined);
    const probed = makeProbedApp({ prefetch: "intent" });
    app = probed.app;
    await app.start();
    const fetchSpy = serveAbout();

    onLink("pointerdown");
    clickLink();
    await vi.waitFor(() =>
      expect(document.querySelector("#page")?.textContent).toBe("about content")
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/about/");
    expect(location.pathname).toBe("/about/");
    expect(probed.navigated).toEqual(["/about/"]);
  });

  // Bug: preload listeners or the viewport observer survive onStop and keep fetching pages.
  it('prefetch "visible": after app.stop() no preload listener or observer is left', async () => {
    vi.stubGlobal("navigation", undefined);
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { createApp } = makeCore();
    app = makeApp(createApp, [], { prefetch: "visible" });
    await app.start();
    const fetchSpy = serveAbout();
    expect(observers[0]?.observed.size).toBe(1);

    await app.stop();
    onLink("pointerdown");
    onLink("touchstart");
    onLink("mouseover");
    await pastHoverDelay();

    expect(observers[0]?.observed.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Bug: the default turns preloading on, so a site that never opted in sends extra requests.
  it("prefetch left out: hover and press fetch nothing, the click fetches once as before", async () => {
    vi.stubGlobal("navigation", undefined);
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { createApp } = makeCore();
    app = makeApp(createApp);
    await app.start();
    const fetchSpy = serveAbout();

    onLink("pointerdown");
    onLink("touchstart");
    onLink("mouseover");
    await pastHoverDelay();
    expect(fetchSpy).not.toHaveBeenCalled();
    clickLink();
    await vi.waitFor(() =>
      expect(document.querySelector("#page")?.textContent).toBe("about content")
    );

    expect(observers).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("/about/", { signal: expect.any(AbortSignal) });
  });

  // Bug: SpaConfig.prefetch widened to `string`, so a typo like "hover" compiles.
  it("type-level: spa.prefetch rejects a value that is not a PrefetchMode", () => {
    const { createApp } = makeCore();
    // Never called: the typo would throw the [web] spa.prefetch error at init.
    const withTypo = () =>
      createApp({
        plugins: [sitePlugin, i18nPlugin, routerPlugin, headPlugin, spaPlugin],
        pluginConfigs: {
          site: SITE,
          i18n: { locales: ["en"], defaultLocale: "en" },
          router: { routes: defineRoutes({ home: route("/").render(() => undefined as never) }) },
          spa: {
            // @ts-expect-error not a PrefetchMode
            prefetch: "hover"
          }
        }
      });
    expectTypeOf(withTypo).toBeFunction();
  });
});
