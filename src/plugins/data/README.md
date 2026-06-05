# data

> Standard plugin — the **agnostic data provider** for the SSG→DATA→SPA pattern. It owns ONE contract: `page path → persisted JSON file`, and knows **nothing** about what the data is. On Node (build) `write(entries)` persists one JSON file per page (build supplies the entries it already expanded); in the browser `at(path)` fetches + caches it as `unknown`, used directly as the route's `ctx.data` for `render`. One module owns write **and** read **and** the URL convention, so the file build writes is exactly the URL the client fetches.

> [!NOTE]
> `data` is **not** a framework default — it is optional. Compose it where you need it:
> a Node build (`createApp({ plugins: [dataPlugin, contentPlugin, buildPlugin] })`) so
> `build` can write data sidecars, and your browser entry (`createApp({ plugins: [dataPlugin] })`)
> so `spa` can read them. It declares **no hard `depends`**; the `node:fs` writer is behind a
> lazy `import()` inside `write()`. With `"sideEffects": false`, a browser app that doesn't
> compose it tree-shakes it away.

## The model: the route owns rendering, the provider owns transport

A route is one contract — `.load(ctx)` (real `D`) and `.render(ctx)` (a Preact `VNode` from
`D`). The persisted data IS `load()`'s output, so the SAME `render` runs at build and on the
client:

- **SSG (build):** `load → render → renderToString` → static HTML (SEO + first paint).
- **DATA:** `build` calls `data.write(entries)` to persist each page's `load()` output as JSON.
- **SPA (client nav):** `spa` → `router.match` → `data.at(path)` → `route.render` (Preact),
  the fetched JSON used directly as `ctx.data`. `route.load` does NOT run on the client.

`data` is **agnostic**: its types carry no domain vocabulary. Any Layer-3 shape (docs,
products, metrics, …) integrates by declaring a route with its own `load`/`render`.

## API

| Method | Side | Signature | Purpose |
|--------|------|-----------|---------|
| `write` | Node | `(entries: readonly DataEntry[], options?: { outDir? }) => Promise<DataWriteSummary>` | Persist one JSON file per page (keyed by `fileFor`). Called by `build` after it expands routes. Lazily loads its `node:fs` writer. |
| `at` | browser | `(path: string) => Promise<unknown \| null>` | Fetch (+cache) the persisted data for a page path; used directly as `ctx.data`. `null` on fetch or JSON parse failure (spa falls back). |
| `urlFor` | pure | `(path: string) => string` | `/en/hello/` → `/_data/en/hello/index.json` (browser fetch URL). |
| `fileFor` | pure | `(path: string) => string` | `/en/hello/` → `_data/en/hello/index.json` (outDir-relative file). |

```ts
// Node build: `build` calls app.data.write(...) during its pages phase when
// router.mode() !== "ssg". Compose the plugin + set the global render mode:
import * as routes from "./routes";
const app = createApp({
  plugins: [dataPlugin, contentPlugin, buildPlugin],
  config: { mode: "hybrid" },          // global render mode
  pluginConfigs: { content: { providers: [fileSystemContent({ contentDir: "./content" })] }, router: { routes } }
});
await app.build.run();                 // writes HTML + per-page data sidecars (routes compiled at init)

// Browser app — spa fetches via app.data.at(path) on nav (used directly as ctx.data).
```

## Configuration

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `outputDir` | `string` | `"_data"` | WRITE side (Node): output subdir **relative to the build `outDir`** (a filesystem path). |
| `baseUrl` | `string` | `"/_data/"` | READ side (browser): site-root-relative URL the client fetches from. Keep consistent with `outputDir`. |

## Output shape

- **`<outDir>/<outputDir>/<page-path>/index.json`** — each page's real `load()` output,
  serialized verbatim. The list route persists slim cards; the detail route persists one
  full record. No HTML, no manifest, no domain knowledge. The file URL mirrors the page URL.

## Key invariants

- **Agnostic transport.** `write` persists whatever `data` each entry carries; the source imports no content/Article. Any shape integrates at Layer 3 via a route's `load`/`render`.
- **Right granularity, on demand.** One file per page (keyed by URL); a navigation fetches only its own page's data — independent of site size.
- **Raw transport, no validation step.** `at` returns `unknown` — the persisted JSON IS the page payload (the build wrote it from `load()`), used directly as `ctx.data`. A fetch miss or non-JSON body → `null` → spa HTML fallback.
- **No format drift.** `urlFor`/`fileFor` derive from one `dataSuffix(path)` — the written file is exactly the fetched URL.
- **Node-free read side.** The `node:fs` writer (`writer.ts`) and the `loadJson` Node branch are both behind lazy `import()`; a browser bundle composing `data` pulls zero `node:*` (the writer is a split chunk).
- **Single mode.** `router.mode()` decides everything: `build` writes when `!== "ssg"`; `spa` data-renders when `!== "ssg"`.

## Structure

| File | Role |
|------|------|
| `index.ts` | Wiring (`createPlugin("data", …)`, no hard `depends`). |
| `types.ts` | `DataConfig`, `DataProvider`, `DataEntry`, `DataWriteSummary`, `DataState`. |
| `config.ts` | `defaultDataConfig` (`outputDir`/`baseUrl`). |
| `state.ts` | `createDataState` (`lastWrite` + lazy per-path `cache`). |
| `convention.ts` | `dataSuffix(path)` — the one pure URL↔file mapping. |
| `api.ts` | `dataApi` — node-free; `write()` (lazy writer) + `at()` (fetch+cache) + `urlFor`/`fileFor`. |
| `validate.ts` | `validateDataConfig` — `baseUrl` check at `onInit`. |
| `load-json.ts` | Internal isomorphic JSON reader (browser `fetch` / lazy `node:fs`); used by `at()`. |
| `writer.ts` | Node-only per-page writer (`node:fs`); imported lazily by `write()`. |
