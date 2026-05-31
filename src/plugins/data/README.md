# data

> Standard plugin — the **build-emit half** of the isomorphic two-world data pattern. After a build, it writes a STABLE route-index manifest plus per-route, content-hashed JSON sidecars from the framework's own typed data, so a browser SPA can navigate by fetching JSON instead of full HTML. **Node-only, build-time.** Depends on `router` (route table) and `content` (article data).

> [!NOTE]
> `data` is **not** a framework default. Compose it explicitly for a Node build:
> `createApp({ plugins: [dataPlugin, contentPlugin, buildPlugin] })`. A browser app omits it (and `"sideEffects": false` tree-shakes it away).

## API

| Method | Signature | Purpose |
|--------|-----------|---------|
| `emit` | `(options?: { outDir?: string }) => Promise<EmitSummary>` | Write the route-index manifest + per-route sidecars under `outDir`. AWAITED — call after `await app.build.run()` so the on-disk SSR fragments exist. |

```ts
const app = createApp({
  plugins: [dataPlugin, contentPlugin, buildPlugin],
  pluginConfigs: { content: { contentDir: "./content" } }
});
await app.start();
await app.build.run();      // produce the static site first
await app.data.emit();      // then emit the route-index + sidecars
```

> [!IMPORTANT]
> The `emit()` pipeline (`router.clientManifest()` + `content.loadAll()` →
> `routes-manifest.json` + content-hashed sidecars via `p-limit`) ships in
> web-parity **wave 3**. Until then `emit()` throws `[web] data.emit: not
> implemented (build wave 3)`.

## Configuration

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `outputDir` | `string` | `"_data"` | Output root **relative to the build `outDir`** (a filesystem path) where the manifest + sidecars are written. |
| `payload` | `"fragment" \| "data"` | `"fragment"` | `"fragment"` = pre-rendered HTML-in-JSON (hybrid, no client render layer); `"data"` = data-only projection (pure-SPA, client renders). |

## Output shape

- **`routes-manifest.json`** (`RouteIndexFile`) — a STABLE, un-hashed route index (short cache); each entry's `dataUrl` points at a content-hashed sidecar (long cache).
- **Per-route sidecars** — `SidecarFragment` (`{ html, meta }`) for `payload: "fragment"`, or `SidecarData` (`{ data }`) for `payload: "data"`.

## Key invariants

- **Build ordering is a call-site contract.** There is no `build` `depends` edge; the caller awaits `app.build.run()` then `app.data.emit()`. The plugin holds no resource, so it has no `onStart`/`onStop`.
- **Draft safety.** Production emit must contain ZERO draft data — `emit()` reads `content.loadAll()`'s production-filtered output (drafts already dropped). A lint ban keeps `content.load(` out of any client-consumed path.
- **Serializable only.** Everything written is JSON-serializable so the browser consume-half can `fetch` + `JSON.parse` it.

## Structure

| File | Role |
|------|------|
| `index.ts` | Wiring (`createPlugin("data", …)`, `depends: [router, content]`). |
| `types.ts` | `DataConfig`, `DataApi`, `EmitSummary`, `DataState`, `RouteIndexFile`, `SidecarFragment`, `SidecarData`. |
| `config.ts` | `defaultDataConfig`. |
| `state.ts` | `createDataState` (`lastEmit` slot). |
| `api.ts` | `dataApi` — the `emit()` surface. |
| `validate.ts` | `validateDataConfig` — `payload` discriminant check at `onInit`. |
