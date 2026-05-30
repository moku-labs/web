import { describe, expect, it } from "vitest";
import {
  createSiteApi,
  isAbsoluteUrl,
  isNonEmpty,
  joinCanonical,
  validateSiteConfig
} from "../../api";
import type { Config } from "../../types";

/** A complete, valid site config used across the accessor + canonical tests. */
const validConfig: Config = {
  name: "My Blog",
  url: "https://blog.dev",
  author: "Alex",
  description: "A personal blog about web frameworks."
};

describe("site", () => {
  it("name()/url()/author()/description() return the configured values", () => {
    const api = createSiteApi({ config: validConfig });
    expect(api.name()).toBe("My Blog");
    expect(api.url()).toBe("https://blog.dev");
    expect(api.author()).toBe("Alex");
    expect(api.description()).toBe("A personal blog about web frameworks.");
  });

  it("canonical() joins a leading-slash path against the base url", () => {
    const api = createSiteApi({ config: validConfig });
    expect(api.canonical("/about/")).toBe("https://blog.dev/about/");
  });

  it("canonical() joins a no-leading-slash path against the base url", () => {
    const api = createSiteApi({ config: validConfig });
    expect(api.canonical("about/")).toBe("https://blog.dev/about/");
  });

  it("canonical('') and canonical('/') return the base url unchanged", () => {
    const api = createSiteApi({ config: validConfig });
    expect(api.canonical("")).toBe("https://blog.dev");
    expect(api.canonical("/")).toBe("https://blog.dev");
  });

  it("canonical() preserves the supplied path's trailing slash and avoids double slashes", () => {
    // Base WITH trailing slash should still join with exactly one "/".
    const withTrailing = createSiteApi({
      config: { ...validConfig, url: "https://blog.dev/" }
    });
    expect(withTrailing.canonical("/about/")).toBe("https://blog.dev/about/");
    expect(withTrailing.canonical("about/")).toBe("https://blog.dev/about/");
    // Base WITHOUT trailing slash, nested path, trailing slash preserved.
    const api = createSiteApi({ config: validConfig });
    expect(api.canonical("blog/post/")).toBe("https://blog.dev/blog/post/");
    expect(api.canonical("/blog/post/")).toBe("https://blog.dev/blog/post/");
    // No trailing slash on path → none in result; no double slash at the join.
    expect(api.canonical("about")).toBe("https://blog.dev/about");
    expect(api.canonical("about")).not.toContain("//about");
  });

  it("onInit throws on empty/whitespace name with [web] site.name message", () => {
    expect(() => validateSiteConfig({ config: { ...validConfig, name: "" } })).toThrow(
      "[web] site.name is required.\n  Provide a non-empty site name in pluginConfigs.site.name."
    );
    expect(() => validateSiteConfig({ config: { ...validConfig, name: "   " } })).toThrow(
      "[web] site.name is required."
    );
  });

  it("onInit throws on missing/non-absolute/non-http url with [web] site.url message", () => {
    expect(() => validateSiteConfig({ config: { ...validConfig, url: "" } })).toThrow(
      '[web] site.url must be a valid absolute URL (http/https), received "".\n  Provide an absolute URL in pluginConfigs.site.url, e.g. "https://blog.dev".'
    );
    expect(() => validateSiteConfig({ config: { ...validConfig, url: "blog.dev" } })).toThrow(
      '[web] site.url must be a valid absolute URL (http/https), received "blog.dev".'
    );
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- intentional non-http(s) test input.
    expect(() => validateSiteConfig({ config: { ...validConfig, url: "ftp://x" } })).toThrow(
      '[web] site.url must be a valid absolute URL (http/https), received "ftp://x".'
    );
  });

  it("onInit does not throw for a valid name + absolute http/https url", () => {
    expect(() => validateSiteConfig({ config: validConfig })).not.toThrow();
    expect(() =>
      validateSiteConfig({ config: { ...validConfig, url: "http://localhost:3000" } })
    ).not.toThrow();
  });

  it("helpers: isNonEmpty / isAbsoluteUrl / joinCanonical behave per spec", () => {
    expect(isNonEmpty("x")).toBe(true);
    expect(isNonEmpty("  ")).toBe(false);
    expect(isAbsoluteUrl("https://blog.dev")).toBe(true);
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- intentional non-http(s) test input.
    expect(isAbsoluteUrl("ftp://x")).toBe(false);
    expect(isAbsoluteUrl("blog.dev")).toBe(false);
    expect(joinCanonical("https://blog.dev/", "/about/")).toBe("https://blog.dev/about/");
    expect(joinCanonical("https://blog.dev", "")).toBe("https://blog.dev");
  });
});
