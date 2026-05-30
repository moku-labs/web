import { createCoreConfig } from "@moku-labs/core";
import { describe, expect, it } from "vitest";
import { logPlugin } from "../../index";
import type { LogApi, LogEntry } from "../../types";

/** Context surface a regular plugin sees from the log core plugin. */
type ProbeCtx = { log: LogApi };

/**
 * Build a fresh app whose single regular plugin logs during its own `onInit`
 * and exposes `ctx.log` through its API.
 *
 * @returns The constructed app and the regular plugin instance.
 */
function buildApp() {
  const coreConfig = createCoreConfig("web-test", {
    config: { mode: "production" as const },
    plugins: [logPlugin],
    pluginConfigs: { log: { mode: "test" as const } }
  });

  const probePlugin = coreConfig.createPlugin("probe", {
    onInit: (ctx: ProbeCtx) => {
      ctx.log.info("probe:init", { phase: "onInit" });
    },
    api: (ctx: ProbeCtx) => ({
      logger: ctx.log,
      log: (event: string) => ctx.log.info(event)
    })
  });

  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [probePlugin] });
  const app = createApp();
  return { app, probePlugin };
}

describe("log integration", () => {
  it("constructs with logPlugin + a regular plugin and exposes app.log as LogApi", () => {
    const { app } = buildApp();
    expect(typeof app.log.info).toBe("function");
    expect(typeof app.log.expect).toBe("function");
    expect(typeof app.log.trace).toBe("function");
  });

  it("ctx.log.info/expect/trace work inside a regular plugin's api/onInit", () => {
    const { app, probePlugin } = buildApp();
    const probe = app.require(probePlugin);
    probe.log("probe:api");
    expect(probe.logger.trace().map((e: LogEntry) => e.event)).toContain("probe:api");
    expect(() => probe.logger.expect().toHaveEvent("probe:api")).not.toThrow();
  });

  it("entries accumulate before app.start() (logged during regular-plugin onInit)", () => {
    const { app } = buildApp();
    // No app.start() called — onInit ran during createApp.
    expect(app.log.trace().map((e: LogEntry) => e.event)).toContain("probe:init");
    expect(() => app.log.expect().toHaveEvent("probe:init", { phase: "onInit" })).not.toThrow();
  });

  it("app.log is exposed on the app surface and shares state with ctx.log", () => {
    const { app, probePlugin } = buildApp();
    const probe = app.require(probePlugin);
    probe.log("shared:event");
    // Written via the regular plugin's ctx.log, visible via app.log.
    expect(app.log.trace().map((e: LogEntry) => e.event)).toContain("shared:event");
  });
});
