import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  name: "Hooks Test",
  url: "https://hooks.dev",
  author: "Tester",
  description: "cli hooks fixture"
};

/** Build a minimal SSG + cli app over a temp tree. */
function buildApp(root: string) {
  const outDir = path.join(root, "dist");
  const contentDir = path.join(root, "content");
  mkdirSync(contentDir, { recursive: true });

  const home = route("/")
    .render(() => h("h1", {}, "Home"))
    .head(() => ({ title: "Home" }));
  const routes = defineRoutes({ home });

  const coreConfig = createCoreConfig("web-test", {
    config: { stage: "production", mode: "ssg" as const },
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
        notFound: true
      },
      deploy: { target: "cloudflare-pages" as const, outDir, scrubAllowlist: [] },
      cli: { outDir, port: 4173, watchDirs: ["content", "src"] },
      router: { routes }
    }
  });
  return app;
}

describe("cli hooks (depends-merged build events render via the Panel)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "cli-hooks-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("a real build run drives the cli's build:phase + build:complete hooks into rendered output", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    const app = buildApp(tmp);
    await app.start();
    await app.cli.build();
    await app.stop();

    const output = lines.join("\n");
    // Header rendered (proves the API ran).
    expect(output).toContain("moku web");
    // build:phase hook rendered live per-phase rows (e.g. the "pages" phase).
    expect(output).toContain("pages");
    // build:complete hook rendered the BUILD summary block.
    expect(output).toContain("BUILD");
  });
});
