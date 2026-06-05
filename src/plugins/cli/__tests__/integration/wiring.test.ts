import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCoreConfig } from "@moku-labs/core";
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlugin } from "../../../build";
import { contentPlugin } from "../../../content";
import { fileSystemContent } from "../../../content/providers";
import { deployPlugin } from "../../../deploy";
import { headPlugin } from "../../../head";
import { i18nPlugin } from "../../../i18n";
import { logPlugin } from "../../../log";
import { defineRoutes, route, routerPlugin } from "../../../router";
import { sitePlugin } from "../../../site";
import { cliPlugin } from "../../index";

const SITE = {
  name: "CLI Test",
  url: "https://cli.dev",
  author: "Tester",
  description: "cli integration fixture"
};

/** Build the full SSG + deploy + cli app over a temp tree (network-free). */
function buildApp(root: string, overrides: { notFound?: boolean; cliPort?: number } = {}) {
  const outDir = path.join(root, "dist");
  const contentDir = path.join(root, "content");
  mkdirSync(contentDir, { recursive: true });

  const home = route("/")
    .render(() => h("h1", {}, "Home"))
    .head(() => ({ title: "Home" }));
  const routes = defineRoutes({ home });

  const coreConfig = createCoreConfig("web-test", {
    config: { isDevelopment: false, mode: "ssg" as const },
    plugins: [logPlugin],
    pluginConfigs: { log: { mode: "test" as const } }
  });
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  const app = createApp({
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
      site: SITE,
      i18n: { locales: ["en"], defaultLocale: "en" },
      content: { providers: [fileSystemContent({ contentDir })] },
      build: {
        outDir,
        feeds: false,
        sitemap: false,
        images: false,
        ogImage: false,
        minify: false,
        notFound: overrides.notFound ?? true
      },
      deploy: { target: "cloudflare-pages" as const, outDir, scrubAllowlist: [] },
      cli: { outDir, port: overrides.cliPort ?? 4173, watchDirs: ["content", "src"] },
      router: { routes }
    }
  });
  return app;
}

describe("cli wiring (createApp → start → app.cli → stop)", () => {
  let tmp: string;
  let out: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "cli-wiring-"));
    out = path.join(tmp, "dist");
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("starts, mounts app.cli with exactly build/serve/preview/deploy, and stops", async () => {
    const app = buildApp(tmp);
    await app.start();

    expect(typeof app.cli.build).toBe("function");
    expect(typeof app.cli.serve).toBe("function");
    expect(typeof app.cli.preview).toBe("function");
    expect(typeof app.cli.deploy).toBe("function");
    expect(Object.keys(app.cli).toSorted()).toEqual(
      ["build", "deploy", "preview", "serve"].toSorted()
    );

    await app.stop();
  });

  it("app.cli.build() drives the real build plugin into the outDir and asserts the 404 page", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const app = buildApp(tmp);
    await app.start();

    const summary = await app.cli.build();

    expect(summary.outDir).toBe(out);
    expect(summary.pageCount).toBeGreaterThan(0);
    expect(typeof summary.durationMs).toBe("number");
    expect(existsSync(path.join(out, "index.html"))).toBe(true);
    expect(existsSync(path.join(out, "404.html"))).toBe(true);
    expect(log).toHaveBeenCalled();

    await app.stop();
  });

  it("app.cli.build({ assertNotFound:false }) skips the 404 assertion", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const app = buildApp(tmp);
    await app.start();
    const summary = await app.cli.build({ assertNotFound: false });
    expect(summary.pageCount).toBeGreaterThan(0);
    await app.stop();
  });

  it("app.cli.build() throws ERR_CLI_NOT_FOUND when the 404 page is absent", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = buildApp(tmp, { notFound: false });
    await app.start();
    await expect(app.cli.build()).rejects.toMatchObject({ code: "ERR_CLI_NOT_FOUND" });
    await app.stop();
  });

  it("rejects an invalid cli config at construction (onInit validation)", () => {
    expect(() => buildApp(tmp, { cliPort: 70_000 })).toThrowError(
      expect.objectContaining({ code: "ERR_CLI_CONFIG" })
    );
  });
});
