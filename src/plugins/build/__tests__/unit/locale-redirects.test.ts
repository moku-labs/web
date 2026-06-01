/* eslint-disable unicorn/no-null -- fake `TypedRoute.match` stubs return `null` (the real signature returns `TParams | null`) */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RouteDefinition, TypedRoute } from "../../../router/types";
import { generateLocaleRedirects } from "../../phases/locale-redirects";
import { makeCtx } from "../helpers";

/** A `{lang:?}/...` substitution: when `lang` is present it is prefixed, else bare. */
function substitute(pattern: string, params: Record<string, string>): string {
  const out = pattern
    .split("/")
    .map(segment => {
      if (!segment.startsWith("{") || !segment.endsWith("}")) return segment;
      const inner = segment.slice(1, -1);
      const key = inner.endsWith(":?") ? inner.slice(0, -2) : inner;
      return params[key] ?? "";
    })
    .join("/")
    .replaceAll(/\/{2,}/g, "/");
  return out;
}

function makeRoute(pattern: string): RouteDefinition {
  return { pattern, _meta: {}, _handlers: {} };
}

function makeEntries(routes: { name: string; pattern: string }[]): () => TypedRoute[] {
  return () =>
    routes.map(({ name, pattern }) => ({
      pattern,
      name,
      meta: {},
      toUrl: (params: Record<string, string>) => substitute(pattern, params),
      toFile: (params: Record<string, string>) => {
        const clean = substitute(pattern, params).replace(/^\//, "").replace(/\/$/, "");
        return clean === "" ? "index.html" : `${clean}/index.html`;
      },
      match: () => null
    }));
}

describe("build/phases/locale-redirects", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "build-lr-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function ctxWith(routes: { name: string; pattern: string }[]) {
    return makeCtx({
      config: { outDir: tmp, localeRedirects: true },
      requireMap: {
        router: {
          manifest: () => routes.map(r => makeRoute(r.pattern)),
          entries: makeEntries(routes)
        },
        i18n: { locales: () => ["en", "uk"], defaultLocale: () => "en" }
      }
    });
  }

  it("is a no-op when localeRedirects is false/unset", async () => {
    const ctx = makeCtx({
      config: { outDir: tmp },
      requireMap: {
        router: { manifest: () => [], entries: () => [] },
        i18n: { locales: () => ["en"], defaultLocale: () => "en" }
      }
    });
    expect(await generateLocaleRedirects(ctx)).toBeNull();
  });

  it("emits a refresh+canonical redirect HTML at each bare path → default locale", async () => {
    const ctx = ctxWith([{ name: "about", pattern: "/{lang:?}/about/" }]);
    const result = await generateLocaleRedirects(ctx);
    expect(result?.written).toBeGreaterThan(0);
    const html = readFileSync(path.join(tmp, "about", "index.html"), "utf8");
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain("/en/about/");
    expect(html).toContain('rel="canonical"');
  });

  it("never writes a Cloudflare _redirects catch-all file", async () => {
    const ctx = ctxWith([{ name: "about", pattern: "/{lang:?}/about/" }]);
    await generateLocaleRedirects(ctx);
    expect(existsSync(path.join(tmp, "_redirects"))).toBe(false);
  });
});
