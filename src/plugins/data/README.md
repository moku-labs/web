# data

> **Optional provider** — owns one agnostic contract, `page path → persisted JSON file`: `write()` persists per-page JSON on Node, `at()` fetches + caches it in the browser, for DATA navigation.

`data` is the transport seam of the SSG→DATA→SPA pattern. It knows **nothing** about what the data *is* — no domain types appear in its surface. On Node, `build` calls `app.data.write(entries)` to persist one JSON file per page (build supplies the entries it already expanded — no duplicate route expansion here). In the browser, `spa` calls `app.data.at(path)` on navigation; the fetched JSON is used directly as the route's `ctx.data` for `render`, with no validation step. One module owns write **and** read **and** the pure URL convention (`urlFor`/`fileFor`, both derived from a single `dataSuffix(path)`), so the file the build writes is exactly the URL the client fetches — format drift is impossible.

It is **not a framework default**: the consumer composes it where needed (the Node build, the browser app, or both). It declares **no hard `depends`** and is fully browser-composable — the only `node:fs` code lives in `writer.ts` behind a lazy `import()` inside `write()`, so a browser bundle that composes `data` for the read side pulls **zero** `node:*`. Lifecycle is minimal: `onInit` validates `baseUrl` and `preload`. `onStart` schedules the optional `preload: "all"` bundle fetch in a browser, and `onStop` cancels it. With the default `preload: "none"` both are no-ops.

> [!NOTE]
> Compose `data` on **both** sides for client DATA navigation: a Node build (`createApp({ plugins: [dataPlugin, contentPlugin, buildPlugin] })`) so `build` writes the data sidecars, and your browser entry (`createApp({ plugins: [dataPlugin] })` from `@moku-labs/web/browser`) so `spa` reads them. Omit it for a plain static site (HTML-over-fetch). With `"sideEffects": false`, a browser app that never composes it tree-shakes it away.

## Example
```ts
// Node build — `build` calls app.data.write(...) during its pages phase when
// router.mode() !== "ssg". Compose the plugin + set the global render mode:
import { createApp, contentPlugin, buildPlugin, fileSystemContent } from "@moku-labs/web";
import { dataPlugin } from "@moku-labs/web/browser";
import * as routes from "./routes";

const app = createApp({
  plugins: [dataPlugin, contentPlugin, buildPlugin],
  config: { mode: "hybrid" }, // global render mode: "ssg" | "spa" | "hybrid"
  pluginConfigs: {
    content: { providers: [fileSystemContent({ contentDir: "./content" })] },
    router: { routes }
  }
});
await app.build.run(); // writes HTML + per-page data sidecars (routes compiled at init)

// Browser app — spa fetches via app.data.at(path) on nav, used directly as ctx.data:
const raw = await app.data.at("/en/hello/"); // unknown | null (null on fetch/parse failure)
```

## API

Mounted at `app.data` (type {@link DataProvider}).

| Method | Side | Signature | Notes |
|--------|------|-----------|-------|
| `at` | browser | `(path: string) => Promise<unknown \| null>` | Fetch (and cache) the persisted data for a page path from `config.baseUrl`. Concurrent calls for one path share one in-flight request. It never waits for an in-flight preload bundle: an uncached path is fetched at once. A failure is not cached, so a later call retries. Returns the raw parsed JSON as `unknown`, used directly as the route's `ctx.data`. Returns `null` if the fetch or JSON parse fails, so `spa` can fall back to HTML. |
| `write` | Node | `(entries: readonly DataEntry[], options?: { outDir?: string }) => Promise<DataWriteSummary>` | Persist one JSON file per entry, keyed by page path via `fileFor`. Called by `build` after it expands routes. Lazily loads its `node:fs` writer. `options.outDir` defaults to `./dist`. Records the summary in state. |
| `urlFor` | pure | `(path: string) => string` | The browser fetch URL for a page path, e.g. `/en/hello/` → `/_data/en/hello/index.json`. |
| `fileFor` | pure | `(path: string) => string` | The `outDir`-relative file path for a page path, e.g. `/en/hello/` → `_data/en/hello/index.json`. |

`urlFor` and `fileFor` are both derived from the same `dataSuffix(path)`, so the written file and the fetched URL can never drift.

## Configuration

`pluginConfigs.data` — all fields optional (all have defaults). `onInit` validates that `baseUrl` is a non-empty, site-root-relative URL path (must start with `/`) and that `preload` is `"none"` or `"all"`.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `outputDir` | `string` | `"_data"` | WRITE side (Node): output subdir **relative to the build `outDir`** — a filesystem path where `write()` persists the per-page JSON. |
| `baseUrl` | `string` | `"/_data/"` | READ side (browser): site-root-relative URL the client fetches the per-page JSON from. The URL-space mirror of `outputDir`; keep them consistent (`"/" + trim(outputDir) + "/"`). |
| `preload` | `"none" \| "all"` | `"none"` | BOTH sides. `"all"`: `write()` also writes `<outputDir>/_all.json`, and the browser fetches it once when idle and fills the `at()` cache. Set the same value in the Node app and the browser app. |

## Dependencies

No hard `depends` — `data` declares no plugin dependencies and pulls nothing via `ctx.require`. Its relationship to `build` and `spa` is a **call-site contract**, not a wired dependency: `build` calls `app.data.write(...)` during its pages phase (after its Phase-0 clean) when `router.mode() !== "ssg"`; `spa` calls `app.data.at(...)` on navigation under the same mode condition. This keeps the plugin fully browser-composable and node-free on the read side.

## Output

`write()` emits, per entry, one file at:

- **`<outDir>/<outputDir>/<page-path>/index.json`** — each page's serializable `data` (the route's own `load`/projection output, which `build` produced), serialized verbatim with `JSON.stringify`. No HTML, no manifest, no domain knowledge. The file path mirrors the page URL exactly — the same way `build` writes `…/index.html` per page.

The path convention (`convention.ts`):

| Page path | Data file (`fileFor`) | Fetch URL (`urlFor`) |
|-----------|-----------------------|----------------------|
| `/` | `_data/index.json` | `/_data/index.json` |
| `/en/hello/` | `_data/en/hello/index.json` | `/_data/en/hello/index.json` |
| `/en/hello` | `_data/en/hello/index.json` | `/_data/en/hello/index.json` (trailing slash normalized) |

### Preload bundle (`preload: "all"`)

Use it for small static sites, where all page data together is small. One file compresses much better than many: on moku-labs.com, 43 pages are 194 KB gzip as 43 files and 122 KB gzip as one file. After that, every SPA navigation reads data from memory.

- **Build.** `write()` also writes **`<outDir>/<outputDir>/_all.json`** = `{ "<page path>": data, ... }`. Keys are the entry paths, the same keys `at(path)` caches under. Page files always end in `/index.json`, so the name never collides. It is written only with `preload: "all"`, so a default build is unchanged. `DataWriteSummary.bundle` reports it; `fileCount`/`bytes` still count page files only.
- **Browser.** `onStart` waits for an idle main thread (`requestIdleCallback`, `setTimeout` fallback), then fetches `<baseUrl>_all.json` once. It fills the cache for every path not already cached. It skips the fetch when `navigator.connection.saveData` is on. A failed fetch is silent; `at()` keeps fetching single files. `onStop` cancels the idle callback or aborts the fetch.
- **`at()` never waits for the bundle.** While the bundle is in flight, `at(path)` for an uncached path fetches the single file at once. Waiting would make a click right after load slower than no preload: on moku-labs.com (slow 4G, CPU x6, 103 KB bundle) 855 ms vs 653 ms. The fill never overwrites a path that is already cached.
- **Both apps.** The Node app and the browser app are configured separately. Set `data: { preload: "all" }` in both. If only the browser sets it, the bundle fetch 404s silently and navigation stays lazy.

```ts
// src/app.ts (Node build)
pluginConfigs: { data: { preload: "all" } }

// src/spa.tsx (browser)
pluginConfigs: { data: { baseUrl: "/_data/", preload: "all" } }
```

`write()` returns a `DataWriteSummary` — `{ fileCount, bytes, files }` (the `files` paths are `outDir`-relative) — and writes are bounded at concurrency 8 via `p-limit`.

## Design notes

- **Agnostic transport.** `write` persists whatever `data` each entry carries; the source imports no content/Article type. Any Layer-3 shape (docs, products, metrics, …) integrates by declaring a route with its own `load`/`render` — the persisted JSON *is* `load()`'s output, so the same `render` runs at build and on the client and SSR/client parity is structural, not hoped-for.
- **Right granularity, on demand.** One file per page (keyed by URL); a navigation fetches only its own page's data — independent of site size.
- **Raw transport, no validation step.** `at` returns `unknown`; the persisted JSON is used directly as `ctx.data` (no route `.parse()`). A fetch miss or non-JSON body → `null` → `spa` HTML fallback.
- **No format drift.** `urlFor`/`fileFor` derive from one `dataSuffix(path)`, so the written file is exactly the fetched URL.
- **Node-free read side.** The `node:fs` writer (`writer.ts`) and the `loadJson` Node branch are both behind lazy `import()`; a browser bundle composing `data` pulls zero `node:*` (the writer becomes its own split chunk). The read primitive `loadJson` is the single isomorphic seam — `fetch` in the browser, lazy `node:fs/promises` on Node.
- **Single switch.** The global `config.mode` (read via `router.mode()`) decides everything: `build` writes when `!== "ssg"`, `spa` data-renders when `!== "ssg"`.
- **Minimal lifecycle.** `onInit` validates `baseUrl` and `preload`. `onStart`/`onStop` only schedule and cancel the optional preload. State is a `null` `lastWrite` slot (Node) plus an empty per-path `cache` Map and an empty `pending` Map of in-flight fetches (browser), each populated lazily on first use.

## Files

| File | Role |
|------|------|
| `index.ts` | Wiring — `createPlugin("data", …)` with `config`/`createState`/`onInit`/`api`; no hard `depends`. |
| `types.ts` | `DataConfig`, `DataProvider`, `DataEntry`, `DataWriteSummary`, `DataState`. |
| `config.ts` | `defaultDataConfig` (`outputDir` ↔ `baseUrl` defaults agree; `preload: "none"`). |
| `state.ts` | `createDataState` — `null` `lastWrite` + empty per-path `cache` + empty `pending` + `null` `cancelPreload`. |
| `convention.ts` | `dataSuffix(path)` + `relativeDataFile(outputDir, path)` — the one pure URL↔file mapping; `BUNDLE_FILE`, the preload bundle name. |
| `preload.ts` | `startPreload`/`stopPreload` — browser idle fetch of `_all.json` into the `at()` cache (`preload: "all"`). |
| `validate.ts` | `validateDataConfig` — `baseUrl` and `preload` checks at `onInit`. |
| `api.ts` | `dataApi` (+ `DataPluginContext`) — node-free; `write()` (lazy writer) + `at()` (fetch+cache, one request per path in flight) + `urlFor`/`fileFor`. |
| `load-json.ts` | `loadJson` — internal isomorphic JSON reader (browser `fetch` / lazy `node:fs`); used by `at()`. |
| `writer.ts` | `writeData` — Node-only per-page writer (`node:fs`, bounded by `p-limit`), plus the `_all.json` bundle with `preload: "all"`; imported lazily by `write()`. |

---

<sub>Part of <strong><a href="../../../README.md">@moku-labs/web</a></strong> — built on <a href="https://github.com/moku-labs/core">@moku-labs/core</a>.</sub>
