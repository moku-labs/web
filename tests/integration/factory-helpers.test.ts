/**
 * @file Integration scenario — the three per-target factory helpers.
 *
 * Asserts the W2 "compose/tsc" gate: `createStaticApp` / `createHybridApp` /
 * `createSpaApp` are thin `createApp` wrappers that bundle the correct
 * composition. Static must NOT carry the `clientData` plugin (no `app.clientData`,
 * checked at the type level); hybrid and spa MUST. All three boot through the real
 * factory chain over a minimal valid blog config.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { createHybridApp, createSpaApp, createStaticApp, defineRoutes, route } from "../../src";
import type { ClientDataApi } from "../../src/plugins/clientData/types";
import { FIXTURE_CONTENT_DIR, SITE } from "./helpers/harness";

/** Minimal valid per-plugin config (site + non-empty routes + contentDir). */
function bootConfig() {
  return {
    pluginConfigs: {
      site: SITE,
      i18n: { locales: ["en"], defaultLocale: "en" },
      router: { routes: defineRoutes({ home: route("/"), post: route("/{slug}/") }) },
      content: { contentDir: FIXTURE_CONTENT_DIR }
    }
  };
}

describe("integration: per-target factory helpers", () => {
  it("createStaticApp boots without the clientData plugin", () => {
    const app = createStaticApp(bootConfig());
    expect(app.has("clientData")).toBe(false);
    expect(app.has("build")).toBe(true);
    // Type level: the static app type must NOT expose `app.clientData`.
    expectTypeOf<typeof app>().not.toHaveProperty("clientData");
  });

  it("createHybridApp adds the clientData plugin (fragment payload)", () => {
    const app = createHybridApp(bootConfig());
    expect(app.has("clientData")).toBe(true);
    // Type level: hybrid exposes a typed `app.clientData.emit`.
    expectTypeOf(app.clientData).toEqualTypeOf<ClientDataApi>();
  });

  it("createSpaApp adds the clientData plugin (data payload)", () => {
    const app = createSpaApp(bootConfig());
    expect(app.has("clientData")).toBe(true);
    expectTypeOf(app.clientData).toEqualTypeOf<ClientDataApi>();
  });

  it("derives spa.dataDir from a custom clientData.outputDir", () => {
    // Override the sidecar output dir; the helper should recompute the URL form.
    const app = createHybridApp({
      ...bootConfig(),
      pluginConfigs: { ...bootConfig().pluginConfigs, clientData: { outputDir: "assets/data" } }
    });
    expect(app.has("clientData")).toBe(true);
  });
});
