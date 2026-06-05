// @vitest-environment happy-dom
/**
 * @file Integration scenario 3a — SPA client runtime + island hydration.
 *
 * Drives the real `createApp` in SPA mode under happy-dom: registers an island
 * component, boots the client runtime, asserts the island mounts into its
 * `data-component` element, that client navigation swaps the page region + title
 * and re-mounts islands, and that `stop()` tears the runtime down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contentPlugin, createApp, defineRoutes, fileSystemContent, route } from "../../src";
import { createComponent } from "../../src/plugins/spa";
import { FIXTURE_CONTENT_DIR, SITE } from "./helpers/harness";

let mounts = 0;
let unmounts = 0;

/** A minimal island: flags its element on mount, counts mount/unmount lifecycles. */
const counter = createComponent("counter", {
  onMount({ el }) {
    mounts += 1;
    (el as HTMLElement).dataset.mounted = "1";
  },
  onUnMount() {
    unmounts += 1;
  }
});

/** Build the real createApp in SPA mode with the island pre-registered. */
function makeSpaApp() {
  const routes = defineRoutes({
    home: route("/")
      .render(() => undefined as never)
      .head(() => ({ title: "Home" })),
    about: route("/about/")
      .render(() => undefined as never)
      .head(() => ({ title: "About" }))
  });
  const app = createApp({
    // content is node-only — composed explicitly (not a framework default).
    plugins: [contentPlugin],
    config: { mode: "spa" },
    pluginConfigs: {
      site: SITE,
      i18n: { locales: ["en"], defaultLocale: "en" },
      content: { providers: [fileSystemContent({ contentDir: FIXTURE_CONTENT_DIR })] },
      head: {},
      spa: { progressBar: false, components: [counter] }
    }
  });
  app.router.set(routes);
  return app;
}

/** Full HTML document returned by the mocked fetch for a navigated page. */
function pageHtml(title: string, body: string): string {
  return `<html><head><title>${title}</title></head><body><main><section id="page">${body}</section></main></body></html>`;
}

let app: ReturnType<typeof makeSpaApp>;

beforeEach(() => {
  mounts = 0;
  unmounts = 0;
  document.body.innerHTML = `<main><section id="page"><div data-component="counter">home</div></section></main>`;
  document.head.innerHTML = "<title>Home</title>";
});

afterEach(async () => {
  await app?.stop().catch(() => {});
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

describe("integration: SPA islands + client navigation", () => {
  it("mounts a registered island into its data-component element on start", async () => {
    app = makeSpaApp();
    await app.start();

    const el = document.querySelector<HTMLElement>('[data-component="counter"]');
    expect(el?.dataset.mounted).toBe("1");
    expect(mounts).toBe(1);
  });

  it("navigates: swaps the page region + title and re-mounts the island", async () => {
    app = makeSpaApp();
    await app.start();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(pageHtml("About", '<div data-component="counter">about</div>'), {
            status: 200
          })
        )
      )
    );

    app.spa.navigate("/about/");
    await vi.waitFor(() => expect(app.spa.current()).toBe("/about/"));

    expect(document.title).toBe("About");
    const el = document.querySelector<HTMLElement>('[data-component="counter"]');
    expect(el?.textContent).toContain("about");
    // The freshly-swapped island instance mounted; the previous one unmounted.
    expect(el?.dataset.mounted).toBe("1");
    expect(unmounts).toBeGreaterThanOrEqual(1);
    expect(mounts).toBeGreaterThanOrEqual(2);
  });

  it("tears down on stop: a post-stop link click triggers no navigation fetch", async () => {
    app = makeSpaApp();
    await app.start();
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(pageHtml("About", "x"), { status: 200 }))
    );
    vi.stubGlobal("fetch", fetchSpy);

    await app.stop();

    document.body.innerHTML = `<a id="link" href="${SITE.url}/about/">go</a>`;
    const link = document.querySelector("#link") as HTMLAnchorElement;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
