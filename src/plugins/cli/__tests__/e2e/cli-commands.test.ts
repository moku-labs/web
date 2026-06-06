/**
 * @file cli plugin — END-TO-END command suite. Runs under `bun test` (NOT vitest), so
 * the real `Bun.serve`/`Bun.file`/`Bun.build`/`Bun.spawn` runtime backs the cli's server
 * + file seams — the closest-to-production exercise of `build`/`serve`/`preview`/`deploy`.
 *
 * Each scenario stands up a real, writable temp site (Markdown content + a fresh-reading
 * route table) through a real `createApp` (a custom core wires `log`/`env`, mirroring the
 * cli hooks integration suite), then drives `app.cli.*`:
 *   - build   → a real SSG run; assert the emitted `dist/` files.
 *   - preview → a real Bun.serve; fetch clean URLs + a 404 over a real socket.
 *   - serve   → build + Bun.serve + real `fs.watch`; edit a content file and observe the
 *               real rebuild + SSE live-reload + the updated page (the live-edit loop).
 *   - deploy  → the full deploy path, network-free, by patching the lazily-resolved
 *               `globalThis.Bun.spawn` so wrangler is a stub returning a fake success.
 *
 * Why a separate `bun test` file: the cli's server/file/spawn seams resolve `Bun.*` lazily
 * and throw under a non-Bun runtime, and vitest workers have no `Bun` global. vitest only
 * globs `__tests__/unit|integration`, so this `e2e` file is invisible to it; run it with
 * `bun run test:cli-e2e`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCoreConfig } from "@moku-labs/core";
import { h } from "preact";
import { buildPlugin } from "../../../build";
import { contentPlugin } from "../../../content";
import { fileSystemContent } from "../../../content/providers";
import type { Article } from "../../../content/types";
import { deployPlugin } from "../../../deploy";
import { envPlugin } from "../../../env";
import { processEnv } from "../../../env/providers";
import { headPlugin } from "../../../head";
import { i18nPlugin } from "../../../i18n";
import { logPlugin } from "../../../log";
import { defineRoutes, route, routerPlugin } from "../../../router";
import { sitePlugin } from "../../../site";
import { cliPlugin } from "../../index";

/** A complete, valid site config shared by every scenario. */
const SITE = {
  name: "Moku E2E",
  url: "https://e2e.moku.dev",
  author: "Moku Labs",
  description: "The cli end-to-end fixture site."
} as const;

/** Wrangler stdout the mocked spawn emits so the deploy output parser yields a URL + id. */
const WRANGLER_STDOUT = [
  "✨ Compiled Worker successfully",
  "Deployment complete! Take a peek over at https://moku-e2e.pages.dev",
  "Deployment ID: 1a2b3c4d-5e6f-7a8b-9c0d-112233445566"
].join("\n");

/**
 * Write one Markdown article (`<contentDir>/<slug>/en.md`) with all required frontmatter.
 *
 * @param contentDir - The site's content root.
 * @param slug - The article directory name.
 * @param fields - The title + body to embed.
 * @param fields.title - The frontmatter title (also rendered as the page `<h1>`).
 * @param fields.body - The Markdown body.
 * @example
 * writeArticle(dir, "hello", { title: "Hello", body: "Hi." });
 */
function writeArticle(
  contentDir: string,
  slug: string,
  fields: { title: string; body: string }
): void {
  const dir = path.join(contentDir, slug);
  mkdirSync(dir, { recursive: true });
  const front = [
    "---",
    `title: "${fields.title}"`,
    'date: "2026-01-15"',
    `description: "About ${fields.title}."`,
    'tags: ["web"]',
    'language: "en"',
    "---",
    "",
    fields.body,
    ""
  ].join("\n");
  writeFileSync(path.join(dir, "en.md"), front, "utf8");
}

/** Seed the initial two-article fixture site. */
function seedContent(contentDir: string): void {
  writeArticle(contentDir, "hello", { title: "Hello World", body: "The original hello body." });
  writeArticle(contentDir, "about", { title: "About", body: "About this fixture." });
}

/** Render an Article as `<article><h1>title</h1>…html…</article>` so titles are greppable. */
function ArticleView(props: { article: Article }) {
  return h("article", {}, [
    h("h1", { key: "t" }, props.article.frontmatter.title),
    h("div", { key: "b", dangerouslySetInnerHTML: { __html: props.article.html } })
  ]);
}

/** The fresh-reading route table: every loader re-reads content via `ctx.require`, so a rebuild reflects edits. */
function makeRoutes() {
  const home = route("/")
    .render(() => h("h1", {}, SITE.name))
    .head(() => ({ title: SITE.name }));

  const article = route("/{slug}/")
    .generate(async ctx => {
      const byLocale = await ctx.require(contentPlugin).loadAll();
      const articles = byLocale.get(ctx.locale) ?? byLocale.get("en") ?? [];
      return articles.map(item => ({ slug: item.computed.slug }));
    })
    .load(async ctx => {
      const byLocale = await ctx.require(contentPlugin).loadAll();
      const articles = byLocale.get(ctx.locale) ?? byLocale.get("en") ?? [];
      return articles.find(item => item.computed.slug === ctx.params.slug);
    })
    .render(ctx => h(ArticleView, { article: ctx.data as Article }) as ReturnType<typeof h>)
    .head(ctx => ({
      title: (ctx.data as Article).frontmatter.title,
      description: (ctx.data as Article).frontmatter.description
    }));

  return defineRoutes({ home, article });
}

/** A site fixture: the temp tree + its composed app. */
type Fixture = {
  root: string;
  contentDir: string;
  outDir: string;
  app: ReturnType<typeof makeApp>;
};

/**
 * Compose a full SSG + cli app over a temp tree (node plugins + cli). The core wires the
 * `log` (silenced via mode `test`) and `env` (`processEnv` for the deploy token) plugins —
 * core-plugin configs live at `createCoreConfig`, mirroring the cli hooks integration
 * suite. The build skips the slow, preview-irrelevant outputs (feeds/sitemap/og/images)
 * for speed; `notFound` stays on so `cli.build()`'s 404 assertion + preview's fallback
 * both have a page.
 *
 * @param root - The temp project root (holds `content/` + `dist/`).
 * @returns The composed app (already typed by name → `app.cli`, `app.build`, …).
 * @example
 * const app = makeApp(root);
 */
function makeApp(root: string) {
  const outDir = path.join(root, "dist");
  const contentDir = path.join(root, "content");
  const coreConfig = createCoreConfig("web-cli-e2e", {
    config: { stage: "production", mode: "ssg" as const },
    plugins: [logPlugin, envPlugin],
    pluginConfigs: { log: { mode: "test" as const }, env: { providers: [processEnv()] } }
  });
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [] });
  return createApp({
    plugins: [
      sitePlugin,
      i18nPlugin,
      routerPlugin,
      headPlugin,
      contentPlugin,
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
      // Relative outDir: deploy's path-traversal guard resolves it against cwd (the temp
      // root the deploy scenario chdir's into), where the build wrote the same `dist/`.
      deploy: { target: "cloudflare-pages", outDir: "dist", scrubAllowlist: [] },
      cli: { outDir, port: 4173, watchDirs: [contentDir], debounceMs: 30 },
      router: { routes: makeRoutes() }
    }
  });
}

/** Find a free TCP port by binding an ephemeral Bun server and reading the assigned port. */
function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const { port } = probe;
  probe.stop(true);
  if (port === undefined) throw new Error("freePort: Bun.serve did not assign a port");
  return port;
}

/** Poll `check` every 40ms until it resolves truthy or the timeout elapses (then throw). */
async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(40);
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

/** GET a path off the dev/preview server; returns `{ status, body }` (`status: 0` on a connection error). */
async function get(port: number, pathname: string): Promise<{ status: number; body: string }> {
  try {
    const response = await fetch(`http://localhost:${port}${pathname}`);
    return { status: response.status, body: await response.text() };
  } catch {
    return { status: 0, body: "" };
  }
}

/**
 * Connect an SSE client to the live-reload endpoint, run `trigger` (the content edit), and
 * resolve `true` once a `reload` frame arrives (or `false` on timeout). The read is raced
 * against the deadline so a missing reload can't hang past it.
 *
 * @param port - The dev server port.
 * @param trigger - The edit to perform once the SSE stream is open.
 * @param timeoutMs - How long to wait for the reload frame.
 * @returns Whether a `reload` event was observed.
 * @example
 * const reloaded = await awaitReload(port, () => editFile());
 */
async function awaitReload(
  port: number,
  trigger: () => void,
  timeoutMs = 12_000
): Promise<boolean> {
  const response = await fetch(`http://localhost:${port}/__moku_reload`);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buffer = "";
  trigger();
  try {
    while (Date.now() < deadline) {
      const slice = await Promise.race([
        reader.read(),
        Bun.sleep(Math.max(0, deadline - Date.now())).then(() => "timeout" as const)
      ]);
      if (slice === "timeout" || slice.done) break;
      buffer += decoder.decode(slice.value, { stream: true });
      if (buffer.includes("event: reload")) return true;
    }
    return false;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Tear down a running `serve()`/`preview()` by emitting SIGINT and awaiting its promise. */
async function teardownServer(serverPromise: Promise<void>): Promise<void> {
  process.emit("SIGINT");
  await serverPromise;
}

describe("cli end-to-end (real Bun runtime)", () => {
  let fixture: Fixture;
  let prevToken: string | undefined;

  // The env plugin snapshots process.env at app.start(), so the deploy token must be set
  // before any app starts. Harmless for the non-deploy scenarios.
  beforeAll(() => {
    prevToken = process.env.CLOUDFLARE_API_TOKEN;
    process.env.CLOUDFLARE_API_TOKEN = "cf-e2e-token-value-1234567890";
  });
  afterAll(() => {
    if (prevToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = prevToken;
  });

  beforeEach(async () => {
    const root = mkdtempSync(path.join(tmpdir(), "cli-e2e-"));
    const contentDir = path.join(root, "content");
    seedContent(contentDir);
    const app = makeApp(root);
    await app.start();
    fixture = { root, contentDir, outDir: path.join(root, "dist"), app };
  });

  afterEach(async () => {
    await fixture.app.stop();
    rmSync(fixture.root, { recursive: true, force: true });
  });

  test("build emits a real static site (pages + 404)", async () => {
    const summary = await fixture.app.cli.build();

    expect(summary.pageCount).toBeGreaterThanOrEqual(3); // home + hello + about
    const home = readFileSync(path.join(fixture.outDir, "index.html"), "utf8");
    expect(home).toContain(SITE.name);
    const hello = readFileSync(path.join(fixture.outDir, "hello", "index.html"), "utf8");
    expect(hello).toContain("Hello World");
    expect(hello).toContain("The original hello body.");
    // notFound: true ⇒ the 404 page the cli build asserts + preview falls back to.
    expect(readFileSync(path.join(fixture.outDir, "404.html"), "utf8")).toContain("");
  });

  test("preview serves the built dist over a real socket (clean URLs + 404)", async () => {
    await fixture.app.cli.build();

    const port = freePort();
    const serverPromise = fixture.app.cli.preview({ port });
    try {
      await waitFor(async () => {
        const probe = await get(port, "/");
        return probe.status === 200;
      });

      const home = await get(port, "/");
      expect(home.status).toBe(200);
      expect(home.body).toContain(SITE.name);
      // No reload client in preview (mirrors production).
      expect(home.body).not.toContain("EventSource");

      const article = await get(port, "/hello/");
      expect(article.status).toBe(200);
      expect(article.body).toContain("Hello World");

      const missing = await get(port, "/does-not-exist/");
      expect(missing.status).toBe(404);
    } finally {
      await teardownServer(serverPromise);
    }
  });

  test("serve rebuilds and live-reloads on a content edit", async () => {
    const port = freePort();
    const serverPromise = fixture.app.cli.serve({ port });
    try {
      await waitFor(async () => {
        const probe = await get(port, "/");
        return probe.status === 200;
      });

      // The dev server injects the live-reload SSE client into HTML.
      const home = await get(port, "/");
      expect(home.body).toContain("EventSource");

      // The article page reflects the seeded content.
      const before = await get(port, "/hello/");
      expect(before.body).toContain("Hello World");
      expect(before.body).toContain("The original hello body.");

      // Edit the existing article, then assert a reload frame is pushed over SSE.
      const reloaded = await awaitReload(port, () => {
        writeArticle(fixture.contentDir, "hello", {
          title: "Hello Edited",
          body: "The rebuilt hello body."
        });
      });
      expect(reloaded).toBe(true);

      // The rebuild rewrote dist — the served page now reflects the edit.
      await waitFor(async () => {
        const page = await get(port, "/hello/");
        return page.body.includes("Hello Edited");
      });
      const after = await get(port, "/hello/");
      expect(after.body).toContain("Hello Edited");
      expect(after.body).toContain("The rebuilt hello body.");
      expect(after.body).not.toContain("The original hello body.");
    } finally {
      await teardownServer(serverPromise);
    }
  }, 30_000);

  test("deploy runs the full path with a mocked wrangler spawn (network-free)", async () => {
    await fixture.app.cli.build(); // a non-empty dist is a deploy preflight requirement

    const prevCwd = process.cwd();
    const bun = globalThis as unknown as { Bun: { spawn: unknown } };
    const realSpawn = bun.Bun.spawn;
    process.chdir(fixture.root); // deploy.init() writes wrangler.jsonc to cwd
    // Patch the lazily-resolved spawn seam so wrangler is a stub returning a fake success.
    bun.Bun.spawn = () => ({
      stdout: new Response(WRANGLER_STDOUT).body,
      stderr: new Response("").body,
      exited: Promise.resolve(0)
    });

    try {
      const result = await fixture.app.cli.deploy({ yes: true });

      expect(result.deployed).toBe(true);
      if (result.deployed) {
        expect(result.url).toBe("https://moku-e2e.pages.dev");
        expect(result.deploymentId).toBe("1a2b3c4d-5e6f-7a8b-9c0d-112233445566");
        expect(result.branch).toBe("main");
      }
    } finally {
      bun.Bun.spawn = realSpawn;
      process.chdir(prevCwd);
    }
  });
});
