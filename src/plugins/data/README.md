# data

> Standard plugin — the **isomorphic bridge** for the two-world data pattern. It owns the build↔runtime data contract on *both* sides: on Node (build) `emit()` writes a STABLE route-index manifest + per-route content-hashed JSON sidecars; in the browser `load(path)`/`manifest()` fetch and parse those same files and hand the route's data to `spa` for JSON-driven navigation. One module owns write **and** read, so the on-disk format can't drift.

> [!NOTE]
> `data` is **not** a framework default — it is optional. Compose it where you need it:
> a Node build (`createApp({ plugins: [dataPlugin, contentPlugin, buildPlugin] })`) to
> emit, and your browser entry (`createApp({ plugins: [dataPlugin] })`) so `spa` can
> read. It declares **no hard `depends`**, so it composes in either world; `emit()`
> lazily `require`s `router`+`content` at call time (Node only). With
> `"sideEffects": false`, a browser app that doesn't compose it tree-shakes it away.

## API

| Method | Side | Signature | Purpose |
|--------|------|-----------|---------|
| `emit` | Node | `(options?: { outDir?: string }) => Promise<EmitSummary>` | Write the route-index manifest + per-route sidecars under `outDir`. AWAITED — call after `await app.build.run()`. Lazily loads its `node:fs` writer; never contaminates a browser bundle. |
| `manifest` | browser | `() => Promise<RouteIndexFile \| null>` | Fetch (and cache) the STABLE route-index from `config.baseUrl`. `null` on failure. |
| `load` | browser | `(path: string) => Promise<RouteData \| null>` | Resolve `path` against the manifest, fetch the matching sidecar, return its `RouteData`. `null` ⇒ caller (`spa`) falls back to HTML-over-fetch. |

```ts
// Node build — emit the data files:
const app = createApp({
  plugins: [dataPlugin, contentPlugin, buildPlugin],
  pluginConfigs: { content: { contentDir: "./content" } }
});
await app.start();
await app.build.run();   // produce the static site first
await app.data.emit();   // then emit route-index + sidecars

// Browser app — spa reads through the bridge on navigation:
const routeData = await app.data.load("/blog/hello/");
// → { kind: "fragment", html, meta } | { kind: "data", data, meta } | null
```

> [!IMPORTANT]
> Pipelines ship in waves: **W3** = `emit()` (`router.clientManifest()` +
> `content.loadAll()` → `routes-manifest.json` + content-hashed sidecars via
> `p-limit`, lazy `node:fs` writer in `emit.ts`). **W4** = `manifest()`/`load()`
> (fetch + match via the shared `iso-match`) and the `spa` consume-half. Until then
> each method throws `[web] data.<method>: not implemented (build wave N)`.

## Configuration

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `outputDir` | `string` | `"_data"` | WRITE side (Node): output root **relative to the build `outDir`** (a filesystem path). |
| `baseUrl` | `string` | `"/_data/"` | READ side (browser): site-root-relative URL the client fetches from. Different *domain* from `outputDir`; keep consistent (`"/" + trim(outputDir) + "/"`). |
| `payload` | `"fragment" \| "data"` | `"fragment"` | `"fragment"` = `load()` returns pre-rendered HTML (hybrid, no client render layer); `"data"` = raw data the client renders (pure-SPA). |

## Output shape

- **`routes-manifest.json`** (`RouteIndexFile`) — a STABLE, un-hashed route index (short cache); each entry's `dataUrl` points at a content-hashed sidecar (long cache).
- **Per-route sidecars** — `SidecarFragment` (`{ html, meta }`) for `payload: "fragment"`, or `SidecarData` (`{ data, meta }`) for `payload: "data"`.
- **`load()` result** — a discriminated `RouteData`: `{ kind: "fragment", html, meta }` or `{ kind: "data", data, meta }`. `spa` switches on `kind`.

## Key invariants

- **Isomorphic, but each side stays clean.** The `node:fs`/`node:crypto` writer lives behind a lazy `import()` inside `emit()` (W3's `emit.ts`), so composing `data` in a browser app keeps the bundle free of `node:*`. The read side uses only `fetch` + the shared (browser-safe) `iso-match` matcher.
- **No hard `depends`.** `emit()` `require`s `router`+`content` lazily at call time (present in a Node build); a missing one throws a clear `[web]` error. This keeps `data` composable in either world and avoids a default→optional edge from `spa`.
- **`spa` consumes via the API, optionally.** `spa` (a framework default) cannot hard-depend on the optional `data` plugin, so on navigation it checks `ctx.has("data")` → `ctx.require(dataPlugin).load(path)`; otherwise (or on any `null`/throw) it falls back to HTML-over-fetch. `data` owns the format; `spa` owns the DOM.
- **Draft safety.** Production `emit()` reads `content.loadAll()`'s production-filtered output (drafts already dropped) — ZERO draft data in the manifest or any sidecar. A lint ban keeps `content.load(` out of `src/plugins/data/**`.
- **Build ordering is a call-site contract.** `await app.build.run()` then `await app.data.emit()`. No `build` `depends` edge; no `onStart`/`onStop`.

## Structure

| File | Role |
|------|------|
| `index.ts` | Wiring (`createPlugin("data", …)`, no hard `depends`). |
| `types.ts` | `DataConfig`, `DataApi`, `RouteData`, `EmitSummary`, `DataState`, `RouteIndexFile`, `SidecarFragment`, `SidecarData`. |
| `config.ts` | `defaultDataConfig` (`outputDir`/`baseUrl`/`payload`). |
| `state.ts` | `createDataState` (`lastEmit` + lazy `manifest` cache). |
| `api.ts` | `dataApi` — node-free; `emit()` (Node, lazy writer) + `manifest()`/`load()` (browser). |
| `validate.ts` | `validateDataConfig` — `payload` + `baseUrl` checks at `onInit`. |
| `emit.ts` | **(W3)** Node-only writer (`node:fs`/`node:crypto`); imported lazily by `emit()`. |
