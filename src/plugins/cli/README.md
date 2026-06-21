# cli

> **Node-only** — the developer CLI for `@moku-labs/web`: `build` · `serve` · `preview` · `deploy`, each rendered through the animated **Velocity** Panel UI — a `▟▙ moku web` lockup + version/runtime banner, a live phase tree, boxed result panels, and a breathing live-reload pulse.

`cli` mounts exactly five methods at `app.cli` (`build`/`update`/`serve`/`preview`/`deploy`). The four script-driven verbs each render the `▟▙ moku web` lockup + a version/runtime banner, then do their work — running the SSG build, serving `dist/` in-process with live reload, previewing the built output with Cloudflare-Pages clean URLs, or scaffolding + deploying. The fifth, `update(changes)`, is the headless **incremental** rebuild an external dev driver calls per change (e.g. the `@moku-labs/worker` dev session) — no header, no per-command script. There is **no argv parser, no `run()` dispatcher, and no framework bin**: the consumer drives the script-verbs from one thin per-command script (`scripts/{build,serve,preview,deploy}.ts`), each naming its command by *being* it.

It `depends` on the node-only `build` and `deploy` plugins (which makes `cli` node-only too) and PULLs their APIs at call time via `ctx.require(buildPlugin)` / `ctx.require(deployPlugin)`. Live progress rides on **hooks** over those plugins' events, so the renderer updates as a build runs without polling. `cli` owns no long-lived resource at plugin scope, so it has **no `onStart`/`onStop`** — `onInit` does synchronous config validation only. The dev server, preview server, and file watcher are created *inside* `serve()`/`preview()` and torn down on SIGINT/SIGTERM within that same call, so app `stop()` has nothing to clean up.

## Example
```ts
// app.ts — compose the CLI (node-only target)
import { buildPlugin, cliPlugin, createApp, deployPlugin } from "@moku-labs/web";

export const app = createApp({
  plugins: [buildPlugin, deployPlugin, cliPlugin],
  pluginConfigs: { cli: { outDir: "dist", port: 4173, watchDirs: ["content", "src"] } }
});
await app.start();

// scripts/build.ts            scripts/serve.ts      scripts/preview.ts     scripts/deploy.ts
import { app } from "../app";  // …same import…    // …same import…       // …same import…
await app.cli.build();         await app.cli.serve();  await app.cli.preview();  await app.cli.deploy();
```

```jsonc
// package.json — one thin script per command (no flags parsed)
"scripts": {
  "build": "bun scripts/build.ts",
  "dev": "bun scripts/serve.ts",
  "preview": "bun scripts/preview.ts",
  "deploy": "bun scripts/deploy.ts"
}
```

## API

The `Api` surface is mounted at `app.cli` — exactly four methods.

### `build(options?): Promise<BuildSummary>`

Renders the `build` Panel header, runs the SSG build via `ctx.require(buildPlugin).run()` (its `build:phase` / `build:complete` events render live through the cli hooks), then asserts that `<outDir>/<notFoundFile>` exists — Cloudflare Pages flips a project to SPA mode without a top-level `404.html`. Returns `{ outDir, pageCount, durationMs }` (the awaited build result). Throws `ERR_CLI_NOT_FOUND` when the not-found page is missing; pass `{ assertNotFound: false }` to skip the check.

```ts
const summary = await app.cli.build();
console.log(`${summary.pageCount} pages in ${summary.durationMs}ms`);
```

### `update(changes, options?): Promise<BuildSummary>`

Incremental dev rebuild from a set of changed paths — the fast counterpart to `build()` for a long-lived **external** dev driver (e.g. an `@moku-labs/worker` dev session that composes this web client via `server.cli.dev({ onChange: c => web.cli.update(c) })`). Reuses the `build` plugin's incremental engine: skips the destructive clean, scopes the rebuild to `changes` (re-reads only changed Markdown, reuses cached page renders whose data is unchanged), and applies the same dev overrides `serve()` uses (minify off; OG/sitemap/feeds off unless re-enabled via `options.{og,sitemap,feeds}`). An unclassifiable path conservatively forces a full rebuild. Unlike `build()` it renders **no** command header (the external driver owns the per-change TUI) and **skips** the not-found assertion (it's a per-change dev rebuild, not a release build). Returns the same `{ outDir, pageCount, durationMs }` summary.

```ts
await app.cli.update(["src/islands/board.ts"]);          // changed-scoped, dev-fast rebuild
await app.cli.update(["content/post/en.md"], { feeds: true }); // re-enable feeds for this rebuild
```

### `serve(options?): Promise<void>`

The dev loop. Builds once, serves `dist/` in-process via the `Bun.serve` seam, injects a tiny live-reload SSE client into HTML responses (when `liveReload`), watches `watchDirs` recursively, and on a change runs a **debounced** rebuild (`debounceMs`) before rendering the reload line and pushing a browser reload over SSE. Resolves when SIGINT/SIGTERM tears the server + watchers down. `options.port` overrides `config.port`; `options.open` is reserved (not yet implemented).

```ts
await app.cli.serve({ port: 3000 });
```

### `preview(options?): Promise<void>`

A static preview of the built `dist/` with Cloudflare-Pages clean-URL resolution — a trailing slash maps to `index.html`, an extensionless path to `<path>/index.html`, and a miss climbs toward the root for the nearest `404.html` (served with status `404`). **No** reload injection, mirroring production. Resolves on SIGINT/SIGTERM. `options.port` overrides `config.port`.

```ts
await app.cli.preview();
```

### `deploy(options?): Promise<DeployOutcome>`

Scaffolds via `ctx.require(deployPlugin).init({ ci: true })`, then deploys via `.run()`. The y/N confirm is a **local safety net only** — shown **just** on an interactive TTY (`process.stdout.isTTY === true` with `CI` unset). Any non-interactive run (CI, or a piped/non-TTY shell) **skips the prompt and deploys**, so the consumer scripts never hang a pipeline. `options.yes` forces the skip anywhere. The outcome is `{ deployed: true, url, deploymentId, branch, durationMs }` (the awaited deploy result), or `{ deployed: false, reason: "declined" }` only when a TTY user answers no. `options.branch` is forwarded to `deploy.run`.

**Guided by convention.** The thin deploy script enables guided mode by default — `app.cli.deploy({ guided: !process.argv.includes("--cli") })` — so `bun run deploy` runs the **interactive setup wizard** and `bun run deploy --cli` takes the **direct**, CI-safe path. The wizard diagnoses prerequisites (token, account id, `wrangler.jsonc`), **offers to scaffold a `wrangler.jsonc` and a placeholder `.env`** for any missing credentials (created or appended-to, never clobbering an existing key), hard-gates the deploy on everything being green, runs a local build smoke test, deploys, then offers to scaffold a GitHub Actions workflow.

A **failed** direct (`--cli`) deploy — e.g. a missing `CLOUDFLARE_API_TOKEN` — is surfaced through the Panel renderer (a styled `✗ deploy failed` + the cause + an actionable *how to fix* hint pointing at `bun run deploy` and the `.env` secrets) instead of a raw stack trace, then **re-thrown** so a non-interactive run still exits non-zero.

```ts
// scripts/deploy.ts — guided by default, `--cli` for the direct/CI path
await app.cli.deploy({ guided: !process.argv.includes("--cli") });

// or drive it directly:
const outcome = await app.cli.deploy();                          // direct; prompts only on a TTY
await app.cli.deploy({ branch: "preview/landing", yes: true });  // forces the deploy anywhere
```

### Command map

| Method | Replaces | Behavior |
|---|---|---|
| `cli.build()` | `scripts/build.ts` | `build.run()` → assert `dist/404.html` → boxed BUILD panel |
| `cli.update(changes)` | — (external dev driver) | `build.run({ skipClean, changed, overrides })` — incremental, dev-fast; no header, no 404 assert |
| `cli.serve()` | `scripts/dev.ts` | build once → in-process static server (live-reload SSE) + watch → debounced rebuild |
| `cli.preview()` | `scripts/serve.ts` | static server for `dist/`, CF-Pages clean URLs, no reload injection |
| `cli.deploy()` | `scripts/deploy.ts` | TTY-only confirm → `deploy.init({ ci: true })` → `deploy.run()` (CI auto-proceeds) |

## Configuration

`pluginConfigs.cli` — all fields optional; each falls back to the default below.

| Field | Type | Default | Notes |
|---|---|---|---|
| `outDir` | `string` | `"dist"` | Build output dir; served by `preview`, asserted by `build`, rebuilt by `serve`. |
| `port` | `number` | `4173` | Default port for `serve()`/`preview()` (overridable per-call via `options.port`). |
| `watchDirs` | `string[]` | `["content", "src"]` | Directories `serve()` watches recursively for changes. |
| `debounceMs` | `number` | `150` | Debounce window (ms) coalescing FS-event bursts into one rebuild. |
| `notFoundFile` | `string` | `"404.html"` | Filename `build()` asserts at `outDir` root (CF Pages flips to SPA mode without it). |
| `liveReload` | `boolean` | `true` | Inject the live-reload SSE client into HTML during `serve()` (never during `preview()`). |

`onInit` validates the resolved config (synchronous fail-fast) and throws `ERR_CLI_CONFIG` when `port` is not an integer in 1–65535, `outDir`/`notFoundFile` are not non-empty strings, `watchDirs` is not a non-empty array of non-empty strings, or `debounceMs` is negative.

## Dependencies

`depends: [buildPlugin, deployPlugin]` — both node-only, which is why `cli` is node-only and lives only in the node `src/index.ts` barrel (exported as `cliPlugin` + the `Cli` type namespace), **not** in `src/browser.ts` or the isomorphic default set.

| Plugin | Pulled via | Used by | For |
|---|---|---|---|
| [`build`](../build/README.md) | `ctx.require(buildPlugin)` | `build`, `serve` | `.run()` — the SSG build + rebuilds |
| [`deploy`](../deploy/README.md) | `ctx.require(deployPlugin)` | `deploy` | `.init({ ci: true })` then `.run({ branch? })` |

## Events

`cli` declares **no events of its own** (`emit` is typed against an empty map for context compatibility). It is a pure consumer/renderer: it **listens** to dependency events via `hooks` and renders each one.

| Event | Source | Handler |
|---|---|---|
| `build:phase` | `build` | `state.render.phase` — live phase-tree row (spinner → ✓ + timing) |
| `build:complete` | `build` | `state.render.built` — boxed BUILD summary panel |
| `deploy:complete` | `deploy` | `state.render.deployed` — deploy result panel |

> [!NOTE]
> Hooks are fire-and-forget (spec/07 §3) — `emit()` does not await them, so the handlers are render-only. Each command's **return value** comes from the awaited `build.run()` / `deploy.run()` result, never from a hook.

## Design notes

- **Velocity Panel renderer.** Every line of output flows through `CliRenderer` (`state.render`), an injectable seam. `createPanelRenderer` is TTY/truecolor/`NO_COLOR`-aware. On a TTY it draws the `▟▙ moku web` lockup + a version/runtime banner, a live in-place **phase tree** (braille spinner → `✓` + a right-aligned timing column) under an animated indeterminate build bar, full-width boxed **BUILD** + **server** panels (the BUILD box carries a real per-phase time-profile sparkline; the server box the `➜` Local/Network URLs), and a persistent breathing `◍ live` idle pulse during `serve`. Brand pink is the exact 24-bit `#FF1E6F` when `COLORTERM` advertises truecolor, the 16-color `magenta` approximation otherwise, and nothing in plain mode — which degrades to plain ASCII lines (CI logs, pipes), printing one line per completed phase with no animation. A single `unref`'d ticker drives every animation; `render.dispose()` (called by `serve()`'s SIGINT teardown) stops it so the idle pulse never outlives the dev server. Tests inject a line-capturing sink (`{ write, color: false }`) so render output is asserted without parsing ANSI.
- **Version / runtime banner.** The banner reports the *real* version. A published install shows its `package.json` `version` (`v1.2.0`); a source/dev build shows the latest semver tag + `-dev` (`v1.1.0-dev`) — `@moku-labs/web` is released **tag-only**, so the working-tree `package.json` carries no `version`, and this mirrors the publish workflow's source of truth (the highest `v*` tag) rather than `git describe` (which would anchor to a stale ancestor tag on a diverged branch). Alongside it: the live `node` / `bun` / platform and the pinned `@moku-labs/core` version (kept last, least-prominent). Resolved once per process (memoized) in `state.ts`.
- **No real I/O in tests.** All runtime effects live behind injectable `state` seams (mirroring deploy's injectable `spawn`): `render`, `confirm` (stdin y/N), `clock` (`Date.now`), `watch` (recursive `node:fs.watch`), `serveStatic` (`Bun.serve`), `fileResponse` (`Bun.file`), and `networkUrl` (`node:os` LAN IPv4). Every command runs under unit tests without sockets, FS watch, or a TTY.
- **Lazy Bun resolution.** `serveStatic`/`fileResponse` resolve the `Bun` global *at call time*, so a non-Bun runtime fails with a coded error rather than a raw `TypeError`, and the dependency is only required when a long-running command actually starts a server.
- **CI-safe deploy.** The confirm prompt is gated on `isTTY && CI === undefined`; non-interactive runs always proceed, so `DeployOutcome.deployed: false` happens *only* on an interactive "no" (`reason: "declined"`).
- **Pure clean-URL resolver.** `resolveCleanUrl(rootDir, pathname, isFile?)` is server-agnostic — it touches the filesystem only through an injected `FileProbe` and is unit-tested without a socket. `safePath` strips leading `../` so a request can never escape the served root.
- **No-drop rebuilds.** The dev-loop `Rebuilder` coalesces a burst into one build, never overlaps runs, and a change arriving mid-build sets a `dirty` flag that triggers exactly one coalesced re-run when the current build settles.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Wiring harness only — `createPlugin("cli", …)`: `depends`, `createState`, `onInit` validation, the three render hooks, and `api`. |
| `api.ts` | The four methods (`createApi`) + `validateConfig` + the `CliPluginContext`/`CliRequire`/`CliEvents` types. |
| `types.ts` | `Config`, `State`, `CliRenderer`, the option/outcome shapes, and the public `Api` (re-exported via `export type * from "./types"`). |
| `defaults.ts` | `defaultConfig` — the resolved default `Config`. |
| `errors.ts` | `cliError` + `ERROR_PREFIX` (`[web] cli`) — coded errors carrying a stable `code`. |
| `state.ts` | `createState` — wires the production injectable seams (renderer, confirm, clock, watch, Bun server/file, networkUrl); resolves the banner version (latest semver tag + `-dev`, or `package.json` `version`) + the pinned `@moku-labs/core` version. |
| `serve.ts` | The dev loop: `runDevServer`, `createRebuilder`, `createReloadHub`, `createDevHandler`, `injectReloadClient`, `installSignalTeardown`. |
| `preview.ts` | The static preview server: `runPreviewServer`, the pure `resolveCleanUrl`, `safePath`, `statIsFile`, `createPreviewHandler`. |
| `network.ts` | LAN IPv4 derivation for the server-ready panel: `networkUrl`, `lanAddress`. |
| `render/panel.ts` | `createPanelRenderer` — the animated Velocity `CliRenderer`: lockup + version banner, phase tree + build bar, boxed BUILD/server panels, sparkline, idle pulse, `dispose()`. Imports its ANSI/brand primitives (`makePalette`, `box`, `spinnerFrameAt`, `supportsColor`, …) from [`@moku-labs/common/cli`](https://github.com/moku-labs/common) — the shared family kit, so the look is identical across every Moku CLI. |

---

<sub>Part of <strong><a href="../../../README.md">@moku-labs/web</a></strong> — built on <a href="https://github.com/moku-labs/core">@moku-labs/core</a>.</sub>
