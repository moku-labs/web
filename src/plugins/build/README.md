# build

> Complex plugin — the SSG **orchestrator**. Sequences a fixed multi-phase pipeline
> that cleans the output directory, bundles CSS/JS, renders every route to static
> HTML, and emits feeds, sitemap, and OG images — writing the result to `dist/`.

`build` depends on `site`, `i18n`, `content`, `router`, and `head`, and pulls all
domain data from them synchronously via `ctx.require(...)`. It is **API-driven**:
the CLI/consumer calls `app.build.run()` explicitly. There is no `onStart`/`onStop`
(no server, watcher, or persistent handle to manage) — `onInit` performs synchronous
config validation only.

## The god-plugin invariant (the central design rule)

Because `build` touches every other plugin, it is the plugin most at risk of becoming
a god-plugin. The hard rule:

> **Build phases ORCHESTRATE `ctx.require(...)` pulls + `Promise.all` only. They MUST
> NOT inline domain logic that belongs to another plugin.**

Concretely:

- **Markdown / content parsing** stays in `content` — the `content` phase calls
  `ctx.require(contentPlugin).loadAll()` and caches the result; it never parses
  Markdown, runs Shiki, or interprets frontmatter.
- **`<head>` composition** stays in `head` — the `pages` phase calls
  `ctx.require(headPlugin).render(route, data)`; it never assembles `<title>`/`<meta>`.
- **Route resolution** stays in `router` — phases call
  `ctx.require(routerPlugin).manifest()`; build only performs the mechanical
  `{param}` substitution needed to choose a write path (see `phases/paths.ts`).
- **URL / locale rules** stay in `site` / `i18n` — read via `ctx.require`.

`index.ts` is a wiring harness only. All sequencing lives in `pipeline.ts`; each phase
is an internal module under `phases/` (these are NOT plugins and never call
`createPlugin`).

## API

### `run(options?): Promise<BuildResult>`

Runs the full pipeline and writes the site to disk. `options.outDir` overrides the
configured output directory for a single run. Per-run state (`manifest`, `buildCache`,
`runId`) is reset at the start of every run. Returns `{ outDir, pageCount, durationMs }`.

### `phases(): PhaseName[]`

Returns the static phase order (pure introspection):
`["bundle","content","images","pages","feeds","sitemap","og-images","root-index"]`.

## Pipeline

Each phase emits `build:phase` (`status: "start"`, then `"done"` with `durationMs`).
Parallelism within a phase uses `Promise.all` (legal intra-plugin concurrency); all
cross-plugin data is a synchronous PULL via `ctx.require`, never an event.

- **Phase 0 — clean.** Remove + recreate `outDir` (setup, not a boundary).
- **Phase 1 — bundle.** `Bun.build` runs CSS and JS as **separate** passes (dodging
  the Bun mixed-entrypoint segfault), honoring `config.minify`; hashed asset paths are
  cached in `state.buildCache`. The bundler runner is injectable for tests.
- **Phase 2 — content + images** (parallel). `content` delegates to
  `content.loadAll()`; `images` copies static image directories (gated by `config.images`).
- **Phase 3 — pages.** Pull `router.manifest()`; for each route expand instances via
  `route.generate?.(locale)`, load data via `route.load?.(params, locale)`, pull
  `head.render(route, data)`, render the body with `preact-render-to-string`, inject
  the build-id meta tag, and write `outDir/<path>/index.html`. Renders concurrently
  via `Promise.all`. Captures the default (`/`) page for the root index. **When
  `router.mode() !== "ssg"` and the optional `data` plugin is composed**, this same
  expansion also persists each page's `load()` output as JSON via `app.data.write(...)`
  (one file per page URL) — feeding `spa`'s client DATA navigation. `assertDataValidators`
  fails the build if a data-navigable route (`render` + `load`) lacks a `.parse()` validator.
- **Phase 4 — feeds + sitemap + og-images** (parallel, `Promise.allSettled`). Each is
  gated by its config flag, so one failure is reported without losing the others.
- **Phase 5 — root-index.** Write the captured default-page HTML to `outDir/index.html`.

After Phase 5, `build:complete` is emitted with `{ outDir, pageCount, durationMs }`.

### build-id meta injection (Bun cache-bug mitigation)

Every page gets a `<meta name="build-id" content="<runId>">` injected into `<head>`
**after** `head.render()` returns. `head` composes the semantic `<head>`; `build`
appends only this build-infrastructure tag (build metadata, not document content — it
does not violate the god-plugin invariant). The changing `runId` guarantees a unique
document per build, sidestepping a Bun module-cache staleness bug.

### og-images hash cache

The og-images phase renders one image per published article via Satori → SVG → resvg
→ PNG, bounded by a `p-limit(4)` pool (Satori/resvg are CPU-heavy). For each article it
computes `sha256(title + template + size)`; if the hash matches the cache, the image is
**skipped**. The cache is persisted to `<outDir>/.cache/og-images.json` and reloaded on
the next run, so unchanged articles stay cheap. The PNG renderer is injectable so tests
assert the cache-skip and concurrency bound without rasterizing. Font validation happens
in `onInit` (`validateConfig`), not at render time. OG generation is **opt-in**
(`ogImage: false` by default — enabling it requires a `fontDir`).

## Configuration

| Field      | Type                      | Default    | Description                                  |
| ---------- | ------------------------- | ---------- | -------------------------------------------- |
| `outDir`   | `string`                  | `"./dist"` | Output directory for the built site.         |
| `minify`   | `boolean`                 | `true`     | Minify bundled CSS/JS.                        |
| `feeds`    | `boolean`                 | `true`     | Generate RSS/Atom/JSON feeds.                |
| `sitemap`  | `boolean`                 | `true`     | Generate `sitemap.xml` + `robots.txt`.       |
| `images`   | `boolean`                 | `true`     | Copy static images into the output.          |
| `ogImage`  | `OgImageConfig \| false`  | `false`    | OG-image generation (object enables; needs a `fontDir`). |

`ogImage` shallow-replaces wholesale on override (it is a nested object). When enabled,
`onInit` validates that `fontDir` exists and contains at least one `.ttf`/`.otf`/`.woff`
font, throwing an actionable `[web] build.<field>` error otherwise.

## Events

- **`build:phase`** `{ phase, status, durationMs? }` — emitted at each phase boundary.
- **`build:complete`** `{ outDir, pageCount, durationMs }` — emitted once after a run.

Both are notification-only. `build` emits; it listens to nothing (no hooks).
