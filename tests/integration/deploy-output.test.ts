/**
 * @file Integration scenario 3b — Cloudflare deploy scaffolding (network-free).
 *
 * Drives the real `createApp`'s `app.deploy.init()`, which generates the deploy
 * artifacts (wrangler.jsonc + optional GitHub Actions workflow) into `process.cwd()`,
 * deriving the project slug from `site.name()`. Asserts generation, idempotent skip,
 * and drift detection.
 *
 * The full `app.deploy.run()` path (which spawns `bunx wrangler` via `Bun.spawn`)
 * is intentionally NOT exercised here — it is covered by the deploy plugin's own
 * mock-spawn integration tests, and a real spawn would hit the network / a missing
 * Bun runtime under node-vitest.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  contentPlugin,
  createApp,
  defineRoutes,
  deployPlugin,
  fileSystemContent,
  route
} from "../../src";
import { cleanup, FIXTURE_CONTENT_DIR, SITE, tmpDir } from "./helpers/harness";

/** The real createApp configured for deploy scaffolding (slug derives from SITE.name). */
function makeDeployApp() {
  const app = createApp({
    // content + deploy are node-only — composed explicitly (not framework defaults).
    plugins: [contentPlugin, deployPlugin],
    config: { mode: "ssg" },
    pluginConfigs: {
      site: SITE,
      i18n: { locales: ["en"], defaultLocale: "en" },
      content: { providers: [fileSystemContent({ contentDir: FIXTURE_CONTENT_DIR })] },
      deploy: { target: "cloudflare-pages", outDir: "dist" }
    }
  });
  app.router.set(defineRoutes({ home: route("/") }));
  return app;
}

describe("integration: Cloudflare deploy scaffolding (init, network-free)", () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    tmp = tmpDir("int-deploy-");
    prevCwd = process.cwd();
    // init() writes relative to process.cwd(); isolate it to the temp dir.
    process.chdir(tmp);
  });
  afterEach(() => {
    process.chdir(prevCwd);
    cleanup(tmp);
  });

  it("generates wrangler.jsonc + CI workflow with the site-derived project slug", async () => {
    const result = await makeDeployApp().deploy.init({ ci: true });

    expect(result.written).toContain("wrangler.jsonc");
    expect(result.written).toContain(".github/workflows/deploy.yml");
    expect(existsSync(path.join(tmp, "wrangler.jsonc"))).toBe(true);
    expect(existsSync(path.join(tmp, ".github", "workflows", "deploy.yml"))).toBe(true);

    // toSlug("Moku Blog") === "moku-blog".
    const wrangler = readFileSync(path.join(tmp, "wrangler.jsonc"), "utf8");
    expect(wrangler).toContain('"name": "moku-blog"');
    // The CI workflow SHA-pins its actions rather than floating @v tags.
    const workflow = readFileSync(path.join(tmp, ".github", "workflows", "deploy.yml"), "utf8");
    expect(workflow).toMatch(/actions\/checkout@[a-f0-9]{40}/);
  });

  it("is idempotent — never overwrites an existing wrangler.jsonc", async () => {
    const existing = '{ "name": "hand-written" }\n';
    writeFileSync(path.join(tmp, "wrangler.jsonc"), existing, "utf8");

    const result = await makeDeployApp().deploy.init({});

    expect(result.skipped).toContain("wrangler.jsonc");
    expect(result.written).not.toContain("wrangler.jsonc");
    expect(readFileSync(path.join(tmp, "wrangler.jsonc"), "utf8")).toBe(existing);
  });

  it("reports drift in check mode without writing", async () => {
    const drifted = '{ "name": "drifted" }\n';
    writeFileSync(path.join(tmp, "wrangler.jsonc"), drifted, "utf8");

    const result = await makeDeployApp().deploy.init({ check: true });

    expect(result.drifted).toContain("wrangler.jsonc");
    expect(result.written).toHaveLength(0);
    expect(readFileSync(path.join(tmp, "wrangler.jsonc"), "utf8")).toBe(drifted);
  });

  it("exposes run()/getLastDeployment() without invoking the deploy subprocess", () => {
    // Guard the network-free boundary: run() is never called in this suite.
    const app = makeDeployApp();
    expect(typeof app.deploy.run).toBe("function");
    expect(app.deploy.getLastDeployment()).toBeNull();
  });
});
