import { createCoreConfig } from "@moku-labs/core";
import { afterEach, describe, expect, it } from "vitest";
import { envPlugin } from "../../index";
import { cloudflareBindings, dotenv, processEnv } from "../../providers";
import type { EnvApi } from "../../types";

/** Framework config registering only the env core plugin. */
function makeConfig() {
  return createCoreConfig("web-test", {
    config: {},
    plugins: [envPlugin],
    pluginConfigs: { env: { providers: [processEnv()] } }
  });
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__CLOUDFLARE_ENV__;
});

describe("env integration", () => {
  it("createCoreConfig with a real schema resolves and constructs the app", () => {
    const coreConfig = makeConfig();
    const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
    const app = createApp({
      pluginConfigs: {
        env: {
          schema: { PUBLIC_API_URL: { public: true, default: "/api" } },
          providers: []
        }
      }
    });
    expect(app.env.get("PUBLIC_API_URL")).toBe("/api");
  });

  it("a sibling plugin reads ctx.env.get/require/has/getPublic/getPublicMap", () => {
    const coreConfig = makeConfig();
    const { createPlugin, createApp } = coreConfig.createCore(coreConfig, { plugins: [] });

    const captured: Record<string, unknown> = {};
    const siblingPlugin = createPlugin("sibling", {
      onInit(ctx) {
        const env = ctx.env as EnvApi;
        captured.get = env.get("PUBLIC_X");
        captured.require = env.require("PUBLIC_X");
        captured.has = env.has("PUBLIC_X");
        captured.getPublic = env.getPublic();
        captured.getPublicMap = [...env.getPublicMap()];
      }
    });

    createApp({
      plugins: [siblingPlugin],
      pluginConfigs: {
        env: { schema: { PUBLIC_X: { public: true, default: "ok" } }, providers: [] }
      }
    });

    expect(captured.get).toBe("ok");
    expect(captured.require).toBe("ok");
    expect(captured.has).toBe(true);
    expect(captured.getPublic).toEqual({ PUBLIC_X: "ok" });
    expect(captured.getPublicMap).toEqual([["PUBLIC_X", "ok"]]);
  });

  it("two createApp calls produce independent frozen resolved maps", () => {
    const coreConfig = makeConfig();
    const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
    const a = createApp({
      pluginConfigs: { env: { schema: { K: { public: false, default: "a" } }, providers: [] } }
    });
    const b = createApp({
      pluginConfigs: { env: { schema: { K: { public: false, default: "b" } }, providers: [] } }
    });
    expect(a.env.get("K")).toBe("a");
    expect(b.env.get("K")).toBe("b");
    expect(() => (a.env.getPublicMap() as Map<string, string>).set("X", "y")).toThrow(TypeError);
  });

  it("Cloudflare per-request freshness reflects a changed global on re-resolve", () => {
    const coreConfig = makeConfig();
    const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });

    (globalThis as Record<string, unknown>).__CLOUDFLARE_ENV__ = { CF_TOKEN: "req-1" };
    const first = createApp({
      pluginConfigs: {
        env: { schema: { CF_TOKEN: { public: false } }, providers: [cloudflareBindings()] }
      }
    });
    expect(first.env.get("CF_TOKEN")).toBe("req-1");

    (globalThis as Record<string, unknown>).__CLOUDFLARE_ENV__ = { CF_TOKEN: "req-2" };
    const second = createApp({
      pluginConfigs: {
        env: { schema: { CF_TOKEN: { public: false } }, providers: [cloudflareBindings()] }
      }
    });
    expect(second.env.get("CF_TOKEN")).toBe("req-2");
    expect(first.env.get("CF_TOKEN")).toBe("req-1");
  });

  it("dotenv participates in resolution as a provider factory", () => {
    expect(typeof dotenv).toBe("function");
    expect(dotenv().name).toBe("dotenv:.env.local");
  });
});
