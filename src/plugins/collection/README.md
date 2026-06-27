# collection

> **Optional provider** — owns one static-data contract, `(collection, shard) → persisted JSON file`: `write()` persists per-shard JSON on Node, `at()` fetches + caches it in the browser, for on-demand collection reads.

`collection` is the collection-keyed sibling of the page-path-keyed [`data`](../data) plugin. It knows **nothing** about what the data *is* — no domain types appear in its surface. On Node, the build calls `app.collection.write(entries)` to persist one JSON file per shard (the build supplies the shards it already authored — no expansion here). In the browser, a consumer calls `app.collection.at(collection, shard)` on demand; the fetched JSON is returned as `unknown`, with no validation step. One module owns write **and** read **and** the pure URL convention (`urlFor`/`fileFor`, both derived from a single `shardSuffix(collection, shard)`), so the file the build writes is exactly the URL the client fetches — format drift is impossible.

It is **not a framework default**: the consumer composes it where needed (the Node build, the browser app, or both). It declares **no hard `depends`** and is fully browser-composable — the only `node:fs` code lives in `writer.ts` behind a lazy `import()` inside `write()`, so a browser bundle that composes `collection` for the read side pulls **zero** `node:*`. Lifecycle is minimal: `onInit` validates `baseUrl`, and there is **no `onStart`/`onStop`** — the provider holds no long-lived resource.

> [!NOTE]
> Compose `collection` on **both** sides for client collection reads: a Node build so the build writes the shard files, and your browser entry (`createApp({ plugins: [collectionPlugin] })` from `@moku-labs/web/browser`) so the client reads them. The standalone reader `loadCollectionShard` is also exported from `@moku-labs/web/browser` for consumers that read shards without composing the plugin (e.g. a room-layer consumer). With `"sideEffects": false`, a browser app that never composes it tree-shakes it away.

## Example
```ts
// Node build — write build-authored shards during/after the build's pages phase:
import { createApp, buildPlugin } from "@moku-labs/web";
import { collectionPlugin } from "@moku-labs/web/browser";

const app = createApp({ plugins: [collectionPlugin, buildPlugin] });
await app.build.run();
await app.collection.write([
  { collection: "bank", shard: "en/animals", data: animals },
  { collection: "bank", shard: "ru/animals", data: животные }
]);

// Browser app — read a shard on demand, returned directly as unknown:
const raw = await app.collection.at("bank", "en/animals"); // unknown | null (null on fetch/parse failure)
```

## API

Mounted at `app.collection` (type {@link CollectionProvider}).

| Method | Side | Signature | Notes |
|--------|------|-----------|-------|
| `at` | browser | `(collection: string, shard: string) => Promise<unknown \| null>` | Fetch (and cache) the persisted data for a `(collection, shard)` key from `config.baseUrl`. Returns the raw parsed JSON as `unknown`. Returns `null` if the fetch or JSON parse fails, so the consumer can fall back. |
| `write` | Node | `(entries: readonly CollectionShard[], options?: { outDir?: string }) => Promise<CollectionWriteSummary>` | Persist one JSON file per entry, keyed by `(collection, shard)` via `fileFor`. Called by the build after it authors the shards. Lazily loads its `node:fs` writer. `options.outDir` defaults to `./dist`. Records the summary in state. |
| `urlFor` | pure | `(collection: string, shard: string) => string` | The browser fetch URL for a key, e.g. `("bank", "en/animals")` → `/bank/en/animals.json`. |
| `fileFor` | pure | `(collection: string, shard: string) => string` | The `outDir`-relative file path for a key, e.g. `("bank", "en/animals")` → `bank/en/animals.json`. |

`urlFor` and `fileFor` are both derived from the same `shardSuffix(collection, shard)`, so the written file and the fetched URL can never drift.

## Configuration

`pluginConfigs.collection` — all fields optional (the single field has a default). `onInit` validates that `baseUrl` is a string ending with `/`.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `baseUrl` | `string` | `"/"` | READ side (browser): site-root URL prefix the client fetches the per-shard JSON from. The collection name is the top directory under it, so the fetched URL is `baseUrl + collection + "/" + shard + ".json"`. |

## Dependencies

No hard `depends` — `collection` declares no plugin dependencies and pulls nothing via `ctx.require`. Its relationship to `build` is a **call-site contract**, not a wired dependency: the app calls `app.collection.write(...)` during/after the build's pages phase. This keeps the plugin fully browser-composable and node-free on the read side.

## Output

`write()` emits, per entry, one file at:

- **`<outDir>/<collection>/<shard>.json`** — each shard's serializable `data` (the build authored these), serialized verbatim with `JSON.stringify`. No HTML, no manifest, no domain knowledge. The collection name is the top directory and the shard's internal slashes become nested directories.

The path convention (`convention.ts`):

| `(collection, shard)` | Shard file (`fileFor`) | Fetch URL (`urlFor`, `baseUrl = "/"`) |
|-----------------------|------------------------|---------------------------------------|
| `("bank", "ru")` | `bank/ru.json` | `/bank/ru.json` |
| `("bank", "en/animals")` | `bank/en/animals.json` | `/bank/en/animals.json` |
| `("/bank/", "/en/")` | `bank/en.json` | `/bank/en.json` (outer slashes trimmed) |

`write()` returns a `CollectionWriteSummary` — `{ fileCount, bytes, files }` (the `files` paths are `outDir`-relative) — and writes are bounded at concurrency 8 via `p-limit`.

## Design notes

- **Agnostic transport.** `write` persists whatever `data` each shard carries; the source imports no domain type. Any Layer-3 shape (question banks, dictionaries, catalogs, …) integrates by writing shards at build and reading them on demand.
- **Collection-keyed granularity.** One file per `(collection, shard)`; a read fetches only its own shard — independent of collection size. The shard key may carry internal slashes (e.g. `"en/animals"`), which become nested directories.
- **Raw transport, no validation step.** `at` returns `unknown`; the persisted JSON is returned directly to the consumer. A fetch miss or non-JSON body → `null`.
- **No format drift.** `urlFor`/`fileFor` derive from one `shardSuffix(collection, shard)`, so the written file is exactly the fetched URL.
- **Node-free read side.** The `node:fs` writer (`writer.ts`) is behind a lazy `import()`; a browser bundle composing `collection` pulls zero `node:*` (the writer becomes its own split chunk). The read primitive `loadCollectionShard` uses the `fetch` global directly — no `node:*` branch — so it (and the standalone `collectionUrl`) is browser-safe and exported from `@moku-labs/web/browser`.
- **Minimal lifecycle.** `onInit` only (validates `baseUrl`); no `onStart`/`onStop` — the provider holds no long-lived resource. State is a `null` `lastWrite` slot (Node) plus an empty per-shard `cache` Map (browser), each populated lazily on first use.

## Files

| File | Role |
|------|------|
| `index.ts` | Wiring — `createPlugin("collection", …)` with `config`/`createState`/`onInit`/`api`; no hard `depends`. |
| `types.ts` | `CollectionConfig`, `CollectionProvider`, `CollectionShard`, `CollectionWriteSummary`, `CollectionState`. |
| `config.ts` | `defaultCollectionConfig` (`baseUrl: "/"`). |
| `state.ts` | `createCollectionState` — `null` `lastWrite` + empty per-shard `cache`. |
| `convention.ts` | `shardSuffix` + `collectionUrl` + `relativeShardFile` — the one pure URL↔file mapping. |
| `validate.ts` | `validateCollectionConfig` — `baseUrl` check at `onInit`. |
| `read.ts` | `loadCollectionShard` — standalone `fetch`-based shard reader (browser-safe); used by `at()` and exported. |
| `api.ts` | `collectionApi` (+ `CollectionPluginContext`) — node-free; `write()` (lazy writer) + `at()` (fetch+cache) + `urlFor`/`fileFor`. |
| `writer.ts` | `writeCollection` — Node-only per-shard writer (`node:fs`, bounded by `p-limit`); imported lazily by `write()`. |

---

<sub>Part of <strong><a href="../../../README.md">@moku-labs/web</a></strong> — built on <a href="https://github.com/moku-labs/core">@moku-labs/core</a>.</sub>
