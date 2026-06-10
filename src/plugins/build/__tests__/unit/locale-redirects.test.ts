/**
 * Unit tests for the locale-redirects phase, run against the REAL compiled router
 * (`registerRoutes` + `createApi`), not a hand-rolled `toUrl` mock. The compiled
 * `toUrl` serves the default locale BARE on optional `{lang:?}` routes — a mock
 * without that skip asserts redirects the real system never emits (and must not:
 * the pages phase writes real content at those bare paths).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineRoutes, route } from "../../../router";
import { createApi as createRouterApi, registerRoutes } from "../../../router/api";
import type { RouteMap, RouterApi, RouterState } from "../../../router/types";
import { generateLocaleRedirects } from "../../phases/locale-redirects";
import { makeCtx } from "../helpers";

/** The i18n slice every test uses: en (default, served bare) + uk. */
const I18N = { locales: () => ["en", "uk"] as const, defaultLocale: () => "en" };

/**
 * Compile a route map through the REAL router pipeline (validate + compile +
 * `toTypedRoute` projection) and return the real `RouterApi`.
 */
function makeRealRouter(routes: RouteMap): RouterApi {
  // eslint-disable-next-line unicorn/no-null -- RouterState.table is `MatcherTable | null` pre-registration
  const state: RouterState = { table: null };
  const registerContext = {
    state,
    global: { mode: "ssg" as const },
    require: ((plugin: { name: string }) =>
      plugin.name === "i18n" ? I18N : { url: () => "https://blog.dev" }) as Parameters<
      typeof registerRoutes
    >[0]["require"]
  };
  registerRoutes(registerContext, routes);
  return createRouterApi(registerContext);
}

describe("build/phases/locale-redirects (real compiled router)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "build-lr-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function ctxWith(routes: RouteMap, extraRequire: Record<string, unknown> = {}) {
    return makeCtx({
      config: { outDir: tmp, localeRedirects: true },
      requireMap: { router: makeRealRouter(routes), i18n: I18N, ...extraRequire }
    });
  }

  it("is a no-op when localeRedirects is false/unset", async () => {
    const routes = defineRoutes({ home: route("/{lang}/") });
    const ctx = makeCtx({
      config: { outDir: tmp },
      requireMap: { router: makeRealRouter(routes), i18n: I18N }
    });
    expect(await generateLocaleRedirects(ctx)).toBeNull();
  });

  it("emits the bare-root refresh+canonical redirect for a REQUIRED /{lang}/ home", async () => {
    // The bare `/` has no content page for a required-lang app (pages writes only
    // `/en/` + `/uk/`), so this redirect is the only thing keeping `/` from a 404.
    const routes = defineRoutes({
      home: route("/{lang}/").generate(generateContext => [{ lang: generateContext.locale }])
    });
    const result = await generateLocaleRedirects(ctxWith(routes));
    expect(result?.written).toBe(1);
    const html = readFileSync(path.join(tmp, "index.html"), "utf8");
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain('content="0;url=/en/"');
    expect(html).toContain('<link rel="canonical" href="/en/">');
  });

  it("emits a nested bare-path redirect for a REQUIRED /{lang}/about/ route", async () => {
    const routes = defineRoutes({
      about: route("/{lang}/about/").generate(generateContext => [{ lang: generateContext.locale }])
    });
    const result = await generateLocaleRedirects(ctxWith(routes));
    expect(result?.written).toBe(1);
    const html = readFileSync(path.join(tmp, "about", "index.html"), "utf8");
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain("/en/about/");
  });

  it("emits NOTHING for an OPTIONAL {lang:?} route — its bare path IS the default-locale content page", async () => {
    // Regression (2026-06-09 audit): the old mock `toUrl` lacked the real
    // default-locale-bare skip and asserted redirects here. The real compiled
    // `toUrl({ lang: defaultLocale })` returns the BARE url, so target === bareUrl
    // and no job is emitted — by design: the pages phase writes the default-locale
    // content at the bare path (plus a `/en/…` alias), and a redirect would clobber it.
    const routes = defineRoutes({
      about: route("/{lang:?}/about/").generate(generateContext => [
        { lang: generateContext.locale }
      ])
    });

    // Simulate the pages phase's bare-path content page; it must survive untouched.
    const bareFile = path.join(tmp, "about", "index.html");
    mkdirSync(path.dirname(bareFile), { recursive: true });
    writeFileSync(bareFile, "<h1>REAL CONTENT</h1>", "utf8");

    const result = await generateLocaleRedirects(ctxWith(routes));
    expect(result?.written).toBe(0);
    expect(readFileSync(bareFile, "utf8")).toBe("<h1>REAL CONTENT</h1>");
  });

  it("emits NOTHING for a route with no lang segment at all", async () => {
    const routes = defineRoutes({
      api: route("/feed/").generate(() => [{}])
    });
    const result = await generateLocaleRedirects(ctxWith(routes));
    expect(result?.written).toBe(0);
    expect(existsSync(path.join(tmp, "feed", "index.html"))).toBe(false);
  });

  it("a mixed route map redirects ONLY the required-lang routes", async () => {
    const routes = defineRoutes({
      home: route("/{lang}/").generate(generateContext => [{ lang: generateContext.locale }]),
      guide: route("/{lang:?}/guide/").generate(generateContext => [
        { lang: generateContext.locale }
      ])
    });
    const result = await generateLocaleRedirects(ctxWith(routes));
    expect(result?.written).toBe(1);
    expect(existsSync(path.join(tmp, "index.html"))).toBe(true);
    expect(existsSync(path.join(tmp, "guide", "index.html"))).toBe(false);
  });

  it("never writes a Cloudflare _redirects catch-all file", async () => {
    const routes = defineRoutes({
      home: route("/{lang}/").generate(generateContext => [{ lang: generateContext.locale }])
    });
    await generateLocaleRedirects(ctxWith(routes));
    expect(existsSync(path.join(tmp, "_redirects"))).toBe(false);
  });

  it("injects the head plugin's site-level OG block into each emitted redirect", async () => {
    const routes = defineRoutes({
      home: route("/{lang}/").generate(generateContext => [{ lang: generateContext.locale }])
    });
    const ctx = ctxWith(routes, {
      head: {
        // Mirrors head.siteHead's contract: og:url echoes the redirect target.
        siteHead: ({ url }: { url: string; locale?: string }) =>
          `<meta property="og:image" content="https://blog.dev/og-default.png">` +
          `<meta property="og:url" content="${url}">`
      }
    });
    const result = await generateLocaleRedirects(ctx);
    expect(result?.written).toBe(1);
    const html = readFileSync(path.join(tmp, "index.html"), "utf8");

    // The OG block is present, carries the target as og:url, and sits inside <head>.
    expect(html).toContain('<meta property="og:image" content="https://blog.dev/og-default.png">');
    expect(html).toContain('<meta property="og:url" content="/en/">');
    expect(html.indexOf("og:image")).toBeLessThan(html.indexOf("</head>"));
    // Still a redirect.
    expect(html).toContain('http-equiv="refresh"');
  });

  it("emits a bare redirect (no OG) when the head plugin is absent", async () => {
    const routes = defineRoutes({
      home: route("/{lang}/").generate(generateContext => [{ lang: generateContext.locale }])
    });
    await generateLocaleRedirects(ctxWith(routes));
    const html = readFileSync(path.join(tmp, "index.html"), "utf8");
    expect(html).not.toContain("og:image");
    expect(html).toContain('http-equiv="refresh"');
  });
});
