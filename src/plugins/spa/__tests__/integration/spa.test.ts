// @vitest-environment happy-dom
import { createCoreConfig } from "@moku-labs/core";
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { dataPlugin } from "../../../data";
import { headPlugin } from "../../../head";
import { i18nPlugin } from "../../../i18n";
import { logPlugin } from "../../../log";
import { defineRoutes, route, routerPlugin } from "../../../router";
import { sitePlugin } from "../../../site";
import { spaPlugin } from "../../index";
import type { SpaApi } from "../../types";

const SITE = {
  name: "SPA Test",
  url: "https://spa.dev",
  author: "Tester",
  description: "spa integration fixture"
};

/** Build the core (router+head+spa over happy-dom) exposing createPlugin for probes. */
function makeCore() {
  const coreConfig = createCoreConfig("web-test", {
    config: { mode: "production" as const },
    plugins: [logPlugin],
    pluginConfigs: { log: { mode: "test" as const } }
  });
  return coreConfig.createCore(coreConfig, { plugins: [] });
}

/** Build a router+head+spa app over happy-dom (site+i18n satisfy head's deps). */
function makeApp(
  createApp: ReturnType<typeof makeCore>["createApp"],
  extraPlugins: unknown[] = []
) {
  const routes = defineRoutes({
    home: route("/")
      .render(() => undefined as never)
      .head(() => ({ title: "Home" })),
    about: route("/about/")
      .render(() => undefined as never)
      .head(() => ({ title: "About" }))
  });
  return createApp({
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
      router: { routes, mode: "spa" as const },
      head: {},
      spa: { progressBar: false }
    }
  });
}

/** HTML returned by the mocked fetch for the navigated page. */
function pageHtml(title: string, body: string): string {
  return `<html><head><title>${title}</title></head><body><main><section id="page">${body}</section></main></body></html>`;
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

  it("client DATA path: composing dataPlugin fetches the page data, validates via parse, and renders", async () => {
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
        router: { routes, mode: "spa" as const },
        head: {},
        spa: { progressBar: false }
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
  });

  it("type-level: app.spa is SpaApi with register/navigate/current", () => {
    const { createApp } = makeCore();
    app = makeApp(createApp);
    expectTypeOf(app.spa).toMatchTypeOf<SpaApi>();
    expectTypeOf(app.spa.navigate).parameters.toEqualTypeOf<[string]>();
    expectTypeOf(app.spa.current).returns.toEqualTypeOf<string>();
    expectTypeOf(app.spa.register).parameter(0).toMatchTypeOf<{ name: string }>();
  });
});
