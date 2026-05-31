// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createComponent, defineRoutes, hydrate, route } from "../../src/client";

/** A route map shared across the hydrate cases below. */
const routes = defineRoutes({ home: route("/"), post: route("/blog/{slug}/") });

/** Minimal site/i18n config every case needs. */
const config = {
  site: { name: "Blog", url: "https://blog.dev", author: "Ada", description: "Notes" },
  i18n: { locales: ["en"], defaultLocale: "en" }
} as const;

describe("hydrate (@moku-labs/web/client)", () => {
  it("boots the SPA runtime and returns a navigate/register handle", () => {
    const app = hydrate({
      routes,
      components: [createComponent("counter", {})],
      config: {
        ...config,
        spa: { viewTransitions: true, components: [createComponent("modal", {})] }
      }
    });

    expect(typeof app.navigate).toBe("function");
    expect(typeof app.register).toBe("function");
    expect(() => app.register(createComponent("late", {}))).not.toThrow();
    // fetch is unavailable/headless under happy-dom; processNav swallows the error.
    expect(() => app.navigate("/about/")).not.toThrow();
  });

  it("works with no components and no spa config (defaults applied)", () => {
    const app = hydrate({ routes, config });
    expect(app).toBeDefined();
    expect(typeof app.navigate).toBe("function");
  });

  it("fail-fast validates the route map (empty map throws)", () => {
    expect(() => hydrate({ routes: {}, config })).toThrow(/route map is empty/);
  });
});
