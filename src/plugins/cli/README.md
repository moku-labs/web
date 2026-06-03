# cli

> Complex plugin — the node-only developer CLI for `@moku-labs/web`. Exposes exactly four
> methods — `app.cli.build / serve / preview / deploy` — each rendering through a boxed
> **Panel** UI (a `MOKU WEB` header → live build phases → BUILD summary block → bordered
> server-ready panel → reload lines → y/N deploy confirm). There is **no argv parser, no
> `run()` dispatcher, and no framework bin**: the consumer drives the plugin from one thin
> per-command script.

`cli` is **API-driven**: nothing happens at framework start. It `depends` on the node-only
`build` and `deploy` plugins, which makes `cli` node-only too — it is exported from the node
`src/index.ts` barrel for Layer-3 composition and is **not** in the isomorphic default plugin
set nor in `src/browser.ts`. Live build/deploy progress rides on **hooks** over the
`build`/`deploy` plugins' events, so the renderer updates as a build runs without any polling.

There is no `onStart`/`onStop` — `cli` owns no long-lived resource at plugin scope. The dev
server, the static preview server, and the file watcher are created **inside** `serve()` /
`preview()` (only when a long-running command is invoked) and are torn down on SIGINT/SIGTERM
within that call, so app `stop()` has nothing to clean up. `onInit` performs synchronous
config validation only.

`index.ts` is a wiring harness only. All logic lives in sibling modules: `api.ts` (the four
methods + `validateConfig` + the `CliPluginContext` type), `render/ansi.ts` (TTY/`NO_COLOR`
color + box helpers), `render/panel.ts` (the Panel renderer), `network.ts` (LAN IPv4
derivation), `preview.ts` (the **pure**, server-agnostic clean-URL resolver + the preview
server), `serve.ts` (the dev loop: build → static server + live-reload SSE → watch → debounced
rebuild), and `state.ts` (the injectable seams).

## Command ↔ legacy-script map

| API              | Replaces           | Behavior                                                                 |
| ---------------- | ------------------ | ------------------------------------------------------------------------ |
| `cli.build()`    | `scripts/build.ts` | `app.build.run()` → assert `dist/404.html` → Panel BUILD block           |
| `cli.serve()`    | `scripts/dev.ts`   | build once → in-process static server (live-reload SSE) + watch → rebuild |
| `cli.preview()`  | `scripts/serve.ts` | static server for `dist/`, CF-Pages clean URLs, no reload injection       |
| `cli.deploy()`   | `scripts/deploy.ts`| TTY-only confirm → `app.deploy.init()` → `app.deploy.run()` (CI auto-proceeds) |

## API

The API surface (`Api`) is mounted at `ctx.cli` (and as `app.cli`) — exactly four methods.

### `build(options?): Promise<BuildSummary>`

Renders the `build` Panel header, runs the SSG build via `app.build.run()` (its
`build:phase` / `build:complete` events render live through the cli hooks), then asserts that
`<outDir>/<notFoundFile>` exists — Cloudflare Pages flips a project to SPA mode without a
top-level `404.html`. Returns `{ outDir, pageCount, durationMs }` (the awaited build result).
Throws `ERR_CLI_NOT_FOUND` when the not-found page is missing; pass `{ assertNotFound: false }`
to skip that check.

```ts
const summary = await app.cli.build();
console.log(`${summary.pageCount} pages in ${summary.durationMs}ms`);
```

### `serve(options?): Promise<void>`

The dev loop. Builds once, serves `dist/` in-process via `Bun.serve`, injects a tiny
live-reload SSE client into HTML responses (when `liveReload`), watches `watchDirs`
recursively, and on a change runs a **debounced** rebuild (`debounceMs`) before rendering the
reload line and pushing a browser reload over SSE. Resolves when SIGINT/SIGTERM tears the
server + watchers down. `options.port` overrides `config.port`.

```ts
await app.cli.serve({ port: 3000 });
```

### `preview(options?): Promise<void>`

A static preview of the built `dist/` with Cloudflare-Pages clean-URL resolution — a trailing
slash maps to `index.html`, an extensionless path to `<path>/index.html`, and a miss climbs to
the nearest `404.html` (served with status 404). **No** reload injection, mirroring production.
Resolves on SIGINT/SIGTERM. The clean-URL resolver (`resolveCleanUrl`) is a pure,
server-agnostic function, unit-tested without a socket.

```ts
await app.cli.preview();
```

### `deploy(options?): Promise<DeployOutcome>`

Scaffolds via `app.deploy.init({ ci: true })`, then deploys. The y/N confirm is a **local
safety net only** — it is shown **just** on an interactive TTY (`process.stdout.isTTY` with
`CI` unset). Any non-interactive run — CI, or a piped/non-TTY shell — **skips the prompt and
deploys**, so the consumer scripts never hang a pipeline. `options.yes` forces the skip
anywhere. The outcome is `{ deployed: true, url, deploymentId, branch, durationMs }` (the
awaited deploy result), or `{ deployed: false, reason: "declined" }` only when a TTY user
answers no. `options.branch` is forwarded to `app.deploy.run`.

```ts
// Interactive (prompts only on a TTY):
const outcome = await app.cli.deploy();

// CI / non-TTY: deploys automatically (no prompt). `yes` forces it on a TTY too:
await app.cli.deploy({ branch: "preview/landing", yes: true });
```

## The consumer "CLI" (thin per-command scripts)

The framework ships **only the plugin**. The consumer keeps one thin script per command — each
names its command by *being* it, with no flags parsed:

```ts
// scripts/build.ts                 // scripts/serve.ts  (dev: build + watch + reload)
import { app } from "../src/app";   import { app } from "../src/app";
await app.cli.build();              await app.cli.serve();

// scripts/preview.ts               // scripts/deploy.ts
import { app } from "../src/app";   import { app } from "../src/app";
await app.cli.preview();            await app.cli.deploy();
```

```jsonc
// package.json
"scripts": {
  "build":   "bun scripts/build.ts",
  "dev":     "bun scripts/serve.ts",
  "preview": "bun scripts/preview.ts",
  "deploy":  "bun scripts/deploy.ts"
}
```

These scripts live in the consumer app, not in the framework. The plugin itself is composed in
the app's `createApp` call:

```ts
import { buildPlugin, cliPlugin, createApp, deployPlugin } from "@moku-labs/web";

const app = createApp({
  plugins: [/* …content/build/deploy/data… */ buildPlugin, deployPlugin, cliPlugin],
  pluginConfigs: {
    cli: { outDir: "dist", port: 4173, watchDirs: ["content", "src"] }
  }
});
await app.start();
```

## Configuration

| Field          | Type       | Default               | Description                                                                                   |
| -------------- | ---------- | --------------------- | --------------------------------------------------------------------------------------------- |
| `outDir`       | `string`   | `"dist"`              | Build output directory; served by `preview`, asserted by `build`, rebuilt by `serve`.         |
| `port`         | `number`   | `4173`                | Default port for `serve()`/`preview()` (overridable per-call via `options.port`).             |
| `watchDirs`    | `string[]` | `["content", "src"]`  | Directories `serve()` watches for changes (recursive).                                        |
| `debounceMs`   | `number`   | `150`                 | Debounce window (ms) coalescing FS-event bursts into one rebuild.                             |
| `notFoundFile` | `string`   | `"404.html"`          | Filename `build()` asserts exists at `outDir` root (CF Pages flips to SPA mode without it).   |
| `liveReload`   | `boolean`  | `true`                | Inject the live-reload SSE client into HTML during `serve()` (never during `preview()`).      |

`onInit` validates the resolved config (synchronous fail-fast) and throws `ERR_CLI_CONFIG`
when `port` is not an integer in 1–65535, `outDir`/`notFoundFile` are not non-empty strings,
`watchDirs` is not a non-empty array of non-empty strings, or `debounceMs` is negative.

## Events

**None.** `cli` declares no per-plugin events. It is a pure consumer/renderer of other plugins'
events: it **listens** to `build:phase` and `build:complete` (from `build`) and
`deploy:complete` (from `deploy`) via hooks, and emits nothing.

## Rendering

The Panel renderer is TTY/`NO_COLOR`-aware (modeled on the legacy `scripts/_log.ts`): it draws
Unicode box borders + ANSI color only when `process.stdout.isTTY` is true and `NO_COLOR` is
unset, and falls back to plain ASCII lines otherwise (CI logs, pipes). Every line of output
flows through the renderer, which is an injectable state seam — tests supply a line-capturing
fake so render output can be asserted without parsing ANSI.

## Notes

The fire-and-forget invariant (spec/07 §3) means `emit()` does not await hooks, so the cli's
hook handlers are render-only. Each command's **return value** therefore comes from the awaited
`app.build.run()` / `app.deploy.run()` result, never from a hook.
