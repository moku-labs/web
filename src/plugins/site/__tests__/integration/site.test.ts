import { createCoreConfig } from "@moku-labs/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { sitePlugin } from "../../index";

/** A complete, valid site config used across the integration scenarios. */
const siteConfig = {
  name: "My Blog",
  url: "https://blog.dev",
  author: "Alex",
  description: "A personal blog about web frameworks."
};

/**
 * Builds a fresh app registering only the site plugin (the unbuilt sibling
 * plugins would otherwise throw during state creation). Mirrors the env/log
 * integration harness: a minimal `createCoreConfig` + `createCore`.
 *
 * @returns The configured `createApp` and `createPlugin` factories.
 */
function makeFactories() {
  const coreConfig = createCoreConfig("web-test", {
    config: {},
    plugins: [],
    pluginConfigs: {}
  });
  return coreConfig.createCore(coreConfig, { plugins: [sitePlugin] });
}

describe("site integration", () => {
  it("createApp with site config constructs and exposes app.site.* values end-to-end", () => {
    const { createApp } = makeFactories();
    const app = createApp({ pluginConfigs: { site: siteConfig } });
    expect(app.site.name()).toBe("My Blog");
    expect(app.site.url()).toBe("https://blog.dev");
    expect(app.site.author()).toBe("Alex");
    expect(app.site.description()).toBe("A personal blog about web frameworks.");
    expect(app.site.canonical("/x/")).toBe("https://blog.dev/x/");
  });

  it("createApp({}) throws fail-fast with [web] site.name is required.", () => {
    const { createApp } = makeFactories();
    expect(() => createApp({})).toThrow("[web] site.name is required.");
  });

  it("ctx.require(sitePlugin) observes the same frozen values cross-plugin", () => {
    const coreConfig = createCoreConfig("web-test", {
      config: {},
      plugins: [],
      pluginConfigs: {}
    });

    const captured: Record<string, string> = {};
    const siblingPlugin = coreConfig.createPlugin("sibling", {
      depends: [sitePlugin],
      onInit(ctx) {
        const site = ctx.require(sitePlugin);
        captured.name = site.name();
        captured.url = site.url();
        captured.canonical = site.canonical("/about/");
      }
    });

    const { createApp } = coreConfig.createCore(coreConfig, {
      plugins: [sitePlugin, siblingPlugin]
    });
    const app = createApp({ pluginConfigs: { site: siteConfig } });

    expect(captured.name).toBe("My Blog");
    expect(captured.url).toBe("https://blog.dev");
    expect(captured.canonical).toBe("https://blog.dev/about/");
    expect(app.site.name()).toBe(captured.name);
  });

  it("provides a typed app.site surface (string accessors + canonical)", () => {
    const { createApp } = makeFactories();
    const app = createApp({ pluginConfigs: { site: siteConfig } });
    expectTypeOf(app.site.name).toBeFunction();
    expectTypeOf(app.site.name()).toBeString();
    expectTypeOf(app.site.url()).toBeString();
    expectTypeOf(app.site.author()).toBeString();
    expectTypeOf(app.site.description()).toBeString();
    expectTypeOf(app.site.canonical).parameter(0).toBeString();
    expectTypeOf(app.site.canonical("/x/")).toBeString();
    expectTypeOf(app.site.canonical).parameter(0).not.toBeNumber();
    // Compile-time only: canonical rejects a non-string path. Wrapped so the
    // erroring expression is never executed at runtime (it would throw).
    const callWithNumber = (): string =>
      // @ts-expect-error — canonical expects a string path, not a number.
      app.site.canonical(123);
    expectTypeOf(callWithNumber).toBeFunction();
  });
});
