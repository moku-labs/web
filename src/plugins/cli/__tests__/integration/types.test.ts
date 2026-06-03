import { createCoreConfig } from "@moku-labs/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { buildPlugin } from "../../../build";
import type * as Build from "../../../build/types";
import { contentPlugin } from "../../../content";
import { deployPlugin } from "../../../deploy";
import { headPlugin } from "../../../head";
import { i18nPlugin } from "../../../i18n";
import { logPlugin } from "../../../log";
import { routerPlugin } from "../../../router";
import { sitePlugin } from "../../../site";
import { cliPlugin } from "../../index";
import type { Api, BuildSummary, DeployOutcome } from "../../types";

/**
 * Construct the full app TYPE (never executed — purely for type assertions). The
 * complete plugin closure is included so `build`'s dependency types resolve.
 */
function makeApp() {
  const coreConfig = createCoreConfig("web-test", {
    config: { mode: "production" as const },
    plugins: [logPlugin],
    pluginConfigs: { log: { mode: "test" as const } }
  });
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  return createApp({
    plugins: [
      sitePlugin,
      i18nPlugin,
      routerPlugin,
      contentPlugin,
      headPlugin,
      buildPlugin,
      deployPlugin,
      cliPlugin
    ],
    pluginConfigs: {
      site: { name: "T", url: "https://t.dev", author: "T", description: "d" },
      i18n: { locales: ["en"], defaultLocale: "en" },
      deploy: { target: "cloudflare-pages" as const, outDir: "dist", scrubAllowlist: [] },
      cli: { outDir: "dist", port: 4173, watchDirs: ["content"] }
    }
  });
}

/** The app type under test — `makeApp` is never invoked. */
type App = ReturnType<typeof makeApp>;

describe("cli type-level surface", () => {
  it("app.cli is the Api with exactly build/serve/preview/deploy", () => {
    expectTypeOf<App["cli"]>().toEqualTypeOf<Api>();
    expectTypeOf<keyof App["cli"]>().toEqualTypeOf<"build" | "serve" | "preview" | "deploy">();
  });

  it("build() returns Promise<BuildSummary> and accepts the documented option", () => {
    expectTypeOf<App["cli"]["build"]>().returns.resolves.toEqualTypeOf<BuildSummary>();
    expectTypeOf<App["cli"]["build"]>()
      .parameter(0)
      .toEqualTypeOf<{ assertNotFound?: boolean } | undefined>();
  });

  it("serve()/preview() resolve to void; deploy() resolves to DeployOutcome", () => {
    expectTypeOf<App["cli"]["serve"]>().returns.resolves.toEqualTypeOf<void>();
    expectTypeOf<App["cli"]["preview"]>().returns.resolves.toEqualTypeOf<void>();
    expectTypeOf<App["cli"]["deploy"]>().returns.resolves.toEqualTypeOf<DeployOutcome>();
  });

  it("build() rejects an unknown option (excess-property check)", () => {
    const build = (() => undefined) as unknown as App["cli"]["build"];
    if (build === undefined) {
      // @ts-expect-error — build() rejects unknown options.
      build({ nope: true });
    }
    expect(typeof build).toBe("function");
  });

  it("a plugin depending on build/deploy gets their merged hook event payloads typed", () => {
    const coreConfig = createCoreConfig("web-test", {
      config: { mode: "production" as const },
      plugins: [logPlugin],
      pluginConfigs: { log: { mode: "test" as const } }
    });
    const { createPlugin } = coreConfig.createCore(coreConfig, { plugins: [] });
    const probe = createPlugin("cli-probe", {
      depends: [buildPlugin, deployPlugin],
      hooks: () => ({
        // The build:phase payload is inferred from the dependency's event map.
        "build:phase": payload => {
          expectTypeOf(payload).toEqualTypeOf<Build.BuildEvents["build:phase"]>();
        },
        // deploy:complete is available because deploy is a dependency.
        "deploy:complete": payload => {
          expectTypeOf(payload.url).toEqualTypeOf<string>();
        }
      })
    });
    expect(probe.name).toBe("cli-probe");
  });

  it("rejects a build() option of the wrong type", () => {
    const build = (() => undefined) as unknown as App["cli"]["build"];
    if (build === undefined) {
      // @ts-expect-error — assertNotFound must be a boolean, not a string.
      build({ assertNotFound: "yes" });
    }
    expect(typeof build).toBe("function");
  });
});
