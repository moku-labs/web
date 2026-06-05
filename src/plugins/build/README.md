# build

> **Node-only** — the static-site-generation orchestrator: renders every route to static HTML, then emits feeds (RSS/Atom/JSON), a sitemap, optimized images, and OG images into `outDir`.

`build` owns the fixed, multi-phase SSG pipeline. It `depends` on `site`, `i18n`, `content`, `router`, and `head`, and pulls all domain data from them synchronously via `ctx.require(...)` — never via events. It is **API-driven**: a CLI or consumer calls `app.build.run()` explicitly. There is no `onStart`/`onStop` (no server, watcher, or persistent handle to manage); `onInit` performs synchronous config validation only. It also detects the **optional** `data` plugin via `ctx.has("data")` — when present and the global render mode is not `"ssg"`, it persists one JSON data sidecar per client-navigable page to feed `spa`'s client DATA navigation.

The single most important design decision is the **god-plugin invariant**: because `build` touches every other plugin, each phase ORCHESTRATES `ctx.require(...)` pulls plus `Promise.all` only — it MUST NOT inline domain logic that belongs elsewhere. Markdown parsing stays in `content`, `<head>` composition stays in `head`, route/URL resolution stays in `router`/`site`/`i18n`. `index.ts` is a wiring harness; all sequencing lives in `pipeline.ts`; each phase is an internal module under `phases/` (these are NOT plugins and never call `createPlugin`).

## Example
```ts
import { createApp, contentPlugin, buildPlugin, fileSystemContent } from "@moku-labs/web";
import * as routes from "./routes";

const app = createApp({
  plugins: [contentPlugin, buildPlugin], // node-only — added per target
  config: { mode: "ssg" },
  pluginConfigs: {
    site: { name: "My Blog", url: "https://blog.dev", author: "Me", description: "A blog." },
    i18n: { locales: ["en", "uk"], defaultLocale: "en" },
    content: { providers: [fileSystemContent({ contentDir: "./content" })] },
    router: { routes },
    build: { outDir: "dist", minify: true, feeds: true, sitemap: true, images: true, ogImage: false }
  }
});

const result = await app.build.run();
// → { outDir: "dist", pageCount, durationMs } — static site written to dist/
```

## API

The surface mounted on `app.build` (and reachable via `ctx.require(buildPlugin)`):

| Method | Signature | Notes |
|---|---|---|
| `run` | `(options?: { outDir?: string }) => Promise<BuildResult>` | Runs the full pipeline and writes the site to disk. `options.outDir` overrides the configured output directory for a single run. Per-run state (`manifest`, `buildCache`, `runId`) is reset at the start of every run. Resolves to `{ outDir, pageCount, durationMs }`. |
| `phases` | `() => PhaseName[]` | Returns a fresh array of the static phase order (pure introspection / tooling). |

`phases()` returns the 12 ordered phase names:
`["bundle", "content", "images", "pages", "content-images", "feeds", "sitemap", "og-images", "public", "not-found", "locale-redirects", "root-index"]`.

## Configuration

`pluginConfigs.build` — all fields have defaults; `build` works with no configuration.

| Field | Type | Default | Notes |
|---|---|---|---|
| `outDir` | `string` | `"./dist"` | Output directory for the built site. Validated non-empty in `onInit`. |
| `minify` | `boolean` | `true` | Minify bundled CSS/JS. |
| `feeds` | `boolean` | `true` | Generate RSS/Atom/JSON feeds. |
| `sitemap` | `boolean` | `true` | Generate `sitemap.xml` + `robots.txt`. |
| `images` | `boolean` | `true` | Copy static images + per-article co-located images into the output. |
| `ogImage` | `OgImageConfig \| false` | `false` | OG-image generation. An object enables + configures it (and requires a `fontDir`); `false` disables it. |
| `injectAssets` | `boolean?` | `true` | Auto-inject bundled `main.{css,js}` into rendered pages. |
| `publicDir` | `string?` | `"public"` | Directory copied verbatim into `outDir` (skipped silently if absent). |
| `notFound` | `boolean \| { body?: string }?` | `false` | Emit `outDir/404.html`. `true` = built-in default page; `{ body }` = literal HTML body content. |
| `localeRedirects` | `boolean?` | `false` | Emit per-path i18n bare-path redirect HTML pages. |
| `clientEntry` | `string?` | — | Authoritative client bundle entry path (overrides the conventional scan). |
| `template` | `string?` | — | HTML shell template with `<!--moku:head-->` / `<!--moku:body-->` / `<!--moku:assets-->` placeholders. |

`ogImage` is a nested object, so an override shallow-replaces it wholesale. When enabled, `onInit` validates that `fontDir` exists and contains at least one `.ttf`/`.otf`/`.woff` font, throwing an actionable `[web] build.<field>` error otherwise. `publicDir`, `template`, and `clientEntry` are also validated as strings-when-set in `onInit`.

### `OgImageConfig`

| Field | Type | Default | Notes |
|---|---|---|---|
| `fontDir` | `string` | (required) | Directory with at least one `.ttf`/`.otf`/`.woff` font. Validated in `onInit`. |
| `template` | `string?` | built-in | Path to a custom OG template module. |
| `size` | `{ width; height }?` | `1200×630` | Output card dimensions. |
| `render` | `(input: RichOgInput) => VNode` | built-in | Custom Preact card renderer (`@jsxImportSource preact`); cast to Satori input at the single render boundary. |
| `fonts` | `OgFont[]?` | first-file scan | Explicit named fonts loaded once per build (overrides the first-file scan). |

## Dependencies

`depends: [site, i18n, content, router, head]` — all PULLed synchronously via `ctx.require(...)` inside phases:

| Plugin | Pulled for |
|---|---|
| [`site`](../site/README.md) | Site identity + `canonical()` for feed/sitemap/OG URLs |
| [`i18n`](../i18n/README.md) | Locale set + default locale (feeds are default-locale; pages/sitemap expand per locale) |
| [`content`](../content/README.md) | `loadAll()` article model + `contentDir()` for co-located images |
| [`router`](../router/README.md) | `manifest()` / `entries()` route definitions, compiled `toFile`/`toUrl`, and `mode()` |
| [`head`](../head/README.md) | `render(route, data)` — the composed `<head>` for each page |

> [!NOTE]
> The [`data`](../data/README.md) plugin is an **optional** dependency, not in `depends`. The pages phase detects it via `ctx.has("data")` and writes per-page JSON sidecars (via `ctx.require(dataPlugin).write(...)`) only when it is composed AND `router.mode() !== "ssg"`.

## Events

Both events are notification-only. `build` emits; it listens to nothing (no hooks).

| Event | Payload | When |
|---|---|---|
| `build:phase` | `{ phase: PhaseName; status: "start" \| "done"; durationMs? }` | At each phase boundary. `durationMs` is present only on `"done"`. Gated outputs that are disabled emit NO boundary. |
| `build:complete` | `{ outDir: string; pageCount: number; durationMs: number }` | Once, after a successful run. |

## Output

Written into `outDir` (default `dist/`) — the directory is removed and recreated at the start of every run:

| Path | Phase | Gate |
|---|---|---|
| `assets/main-<hash>.{css,js}` | bundle | always (hashed; `minify` controls minification) |
| `<path>/index.html` (per route) | pages | always |
| `index.html` (root) | root-index | when a default `/` page was rendered |
| `<url>` JSON data sidecars | pages | `mode !== "ssg"` AND `data` plugin composed |
| `assets/…` (static images) | images | `images` |
| `<slug>/images/…` (co-located) | content-images | `images` (+ content dir present) |
| `feed.xml`, `atom.xml`, `feed.json` | feeds | `feeds` |
| `sitemap.xml`, `robots.txt` | sitemap | `sitemap` |
| `og/<slug>.png` + `.cache/og-images.json` | og-images | `ogImage` |
| (verbatim copy of `publicDir`) | public | `publicDir` exists on disk |
| `404.html` | not-found | `notFound` |
| per-path redirect HTML | locale-redirects | `localeRedirects` |

## Design notes

**The pipeline (in order).** Each phase emits `build:phase` (`"start"`, then `"done"` with `durationMs`). Intra-phase parallelism uses `Promise.all`; all cross-plugin data is a synchronous PULL via `ctx.require`.

- **Phase 0 — clean.** Remove + recreate `outDir` (setup, not a boundary).
- **Phase 1 — bundle.** `Bun.build` runs CSS and JS as **separate** passes (dodging the Bun mixed-entrypoint segfault), honoring `config.minify`; hashed asset paths are cached in `state.buildCache`. The bundler runner is injectable for tests.
- **Phase 2 — content + images** (parallel). `content` delegates to `content.loadAll()`; `images` copies static image directories. Gated by `config.images`.
- **Phase 3 — pages.** Pull `router.manifest()`; expand instances via `route.generate?.(genCtx)`, load data via `route.load?.(loadCtx)`, pull `head.render(route, data)`, render the body with `preact-render-to-string`, inject the build-id meta tag, and write `outDir/<path>/index.html` — all concurrently. Write paths and canonical URLs come from the router's compiled `toFile`/`toUrl` (single source of truth), so a route's `.toFile()` override takes effect. Captures the default (`/`) page for the root index, and writes client-data sidecars when applicable.
- **Phase 3.5 — content-images.** Runs after `pages` so the article tree exists before each article's co-located `images/` dir is copied into the shared `<outDir>/<slug>/images/` (reused by every locale).
- **Phase 4 — feeds + sitemap + og-images + public + not-found + locale-redirects** (concurrent, `Promise.allSettled`). Each is gated by its config flag (or, for `public`, the source dir's presence), so one failure is reported via `log.error` without losing the others. A disabled output emits NO `build:phase` boundary.
- **Phase 5 — root-index.** Write the captured default-page HTML to `outDir/index.html`.

After Phase 5, `build:complete` is emitted with `{ outDir, pageCount, durationMs }`.

**build-id meta injection (Bun cache-bug mitigation).** Every page gets a `<meta name="build-id" content="<runId>">` injected into `<head>` **after** `head.render()` returns. `head` composes the semantic `<head>`; `build` appends only this build-infrastructure tag (build metadata, not document content — it does not violate the god-plugin invariant). The changing `runId` guarantees a unique document per build, sidestepping a Bun module-cache staleness bug.

**og-images hash cache.** The og-images phase renders one image per published article via Satori → SVG → resvg → PNG, bounded by a `p-limit(4)` pool (Satori/resvg are CPU-heavy). For each article it computes a `sha256(title + template + size)` (truncated to 16 hex chars); if the hash matches the cache, the image is **skipped**. The cache is persisted to `<outDir>/.cache/og-images.json` and reloaded on the next run, so unchanged articles stay cheap. The PNG renderer is injectable so tests assert the cache-skip and concurrency bound without rasterizing. Font validation happens in `onInit` (`validateConfig`), not at render time. OG generation is **opt-in** (`ogImage: false` by default — enabling it requires a `fontDir`).

**State.** Per-run state holds only caches + config — no domain data is duplicated (it is pulled fresh via `ctx.require` each run): a frozen `config` snapshot, the `manifest` (populated in the pages phase), a per-run `buildCache` (hashed asset paths), a `runId`, and the cross-run `ogImageHashCache`.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Wiring harness — `createPlugin("build", …)`, `depends`, `onInit` validation. |
| `types.ts` | `Config`, `State`, `Api`, `PhaseContext`, `PhaseName`, `BuildResult`, OG/event types. |
| `api.ts` | `createApi` (`run`/`phases`), `defaultConfig`, `validateConfig` (onInit). |
| `config.ts` | (n/a — defaults live in `api.ts` as `defaultConfig`). |
| `events.ts` | `createEvents` — declares `build:phase` and `build:complete`. |
| `state.ts` | `createState` — initial per-run caches + OG hash cache. |
| `pipeline.ts` | `runPipeline` driver + `PHASE_ORDER`; sequences phases, emits boundaries. |
| `phases/bundle.ts` | Phase 1 — CSS/JS bundling (injectable runner). |
| `phases/content.ts` | Phase 2 — load + cache the article model. |
| `phases/images.ts` | Phase 2 — copy static image directories. |
| `phases/pages.tsx` | Phase 3 — SSR every route + write data sidecars. |
| `phases/content-images.ts` | Phase 3.5 — copy per-article co-located images. |
| `phases/feeds.ts` | Phase 4 — RSS/Atom/JSON feeds. |
| `phases/sitemap.ts` | Phase 4 — `sitemap.xml` + `robots.txt`. |
| `phases/og-images.tsx` | Phase 4 — Satori OG images + hash cache. |
| `phases/public.ts` | Phase 4 — copy `publicDir` verbatim. |
| `phases/not-found.ts` | Phase 4 — emit `404.html`. |
| `phases/locale-redirects.ts` | Phase 4 — bare-path i18n redirect pages. |
| `__tests__/` | Per-phase unit tests + one integration build test. |

---

<sub>Part of <strong><a href="../../../README.md">@moku-labs/web</a></strong> — built on <a href="https://github.com/moku-labs/core">@moku-labs/core</a>.</sub>
