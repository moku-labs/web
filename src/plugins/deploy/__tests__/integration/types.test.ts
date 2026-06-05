import { createCoreConfig } from "@moku-labs/core";
import { describe, expectTypeOf, it } from "vitest";
import { logPlugin } from "../../../log";
import { sitePlugin } from "../../../site";
import { deployPlugin } from "../../index";
import type { Api, DeployResult } from "../../types";

/** Build a minimal site+deploy app purely for type assertions. */
function buildApp() {
  const coreConfig = createCoreConfig("web-test", {
    config: { mode: "production" as const },
    plugins: [logPlugin],
    pluginConfigs: { log: { mode: "test" as const } }
  });
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  return createApp({
    plugins: [sitePlugin, deployPlugin],
    pluginConfigs: {
      site: {
        name: "Type Site",
        url: "https://type.dev",
        author: "T",
        description: "d"
      },
      deploy: { target: "cloudflare-pages" as const, outDir: "dist", scrubAllowlist: [] }
    }
  });
}

describe("deploy type-level surface", () => {
  it("app.deploy is typed as Api with the documented method signatures", () => {
    const app = buildApp();

    expectTypeOf(app.deploy).toMatchTypeOf<Api>();
    expectTypeOf(app.deploy.run).returns.resolves.toEqualTypeOf<DeployResult>();
    expectTypeOf(app.deploy.getLastDeployment()).toEqualTypeOf<Readonly<DeployResult> | null>();
    expectTypeOf(app.deploy.init).returns.resolves.toMatchTypeOf<{
      written: string[];
      skipped: string[];
      drifted: string[];
    }>();

    // run accepts the documented options (type-position only — never invoked).
    expectTypeOf(app.deploy.run).parameter(0).toEqualTypeOf<{ branch?: string } | undefined>();

    // ...and rejects an unknown option key (excess-property check). Purely
    // type-level — `_reject` is a typed function reference that is never called.
    const _reject: typeof app.deploy.run = options => app.deploy.run(options);
    if (_reject === undefined) {
      // @ts-expect-error — run() rejects unknown options.
      _reject({ nope: true });
    }
  });
});
