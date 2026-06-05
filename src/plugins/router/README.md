# router plugin

> **Tier:** Complex (`builders/` sub-domain) · **Depends on:** `site`, `i18n` · Wave 2

The single source of truth for the framework's route table: a typed, fluent
route-builder DSL (`route()`), a route-map identity helper (`defineRoutes()`),
compile-time path-param inference (`ExtractRouteParams`), and a runtime matcher
(`match`, `toUrl`, `entries`, `manifest`, `mode`). Downstream plugins (`build`, `head`,
`spa`) consult it via `ctx.require(routerPlugin)` — never via config readback.

## Public surface

```ts
// routes.tsx — plain per-route exports. A loader pulls sibling plugin APIs the spec
// way (ctx.require(pluginInstance)); links come from ctx.url(name, params).
import { route } from "@moku-labs/web";
import { contentPlugin } from "@moku-labs/web";

export const home = route("/").render((ctx) => <Home url={ctx.url} />); // no .load() — optional
export const article = route("/{lang:?}/{slug}/")
  .load((ctx) => ctx.require(contentPlugin).load(ctx.params.slug, ctx.locale)) // ctx.data typed from the return
  .render((ctx) => <Article article={ctx.data} url={ctx.url} />)
  .head((ctx) => ({ title: ctx.data.title }));
```

```ts
// app.ts — register routes via config (create → run).
import { createApp, buildPlugin, contentPlugin } from "@moku-labs/web";
import * as routes from "./routes";

const app = createApp({
  plugins: [contentPlugin, buildPlugin],   // content/build are node-only
  config: { mode: "hybrid" },              // GLOBAL "ssg" | "spa" | "hybrid" — the SSG/DATA/SPA switch
  pluginConfigs: {
    site: { name: "Blog", url: "https://blog.dev", author: "Alex", description: "…" },
    i18n: { locales: ["en", "uk"], defaultLocale: "en" },
    router: { routes }                     // declarative route map (an `import * as` namespace works)
  }
});
await app.build.run();    // or: await app.start(); — routes compiled at init
// Runtime alternative (e.g. (re-)registering dynamically): app.router.set(routes)
```

`ctx.data` in `.render`/`.head` is typed from **`.load()`'s return**; `.load` is OPTIONAL. On a
client nav `spa` uses the fetched JSON (which the build wrote from `load()`) directly as `ctx.data`
— no validation step; a missing/malformed file falls back to HTML-over-fetch. `.load`/`.generate`
run BUILD-ONLY and receive `{ params, locale, require, has }`, so a loader pulls sibling plugin APIs
the canonical way — `ctx.require(contentPlugin)` (spec/08 §7) — with no module global and no
router→content coupling. Content is node-only: keep loaders in a node-imported module; the browser
gets page data from the `data` plugin, never by re-running loaders.

`.render`/`.head` receive **`ctx.url(name, params)`** — a link builder (backed by `router.toUrl`)
the framework delivers, so links need no `app` reference. `route`/`defineRoutes`/`createUrls` are
pure `helpers` (run before `createApp`, no `ctx`); the render **`mode` is a GLOBAL config option**,
and routes are registered the normal config way via **`pluginConfigs.router.routes`** (compiled at
init) or imperatively at runtime with **`app.router.set(routes)`**.

## API (`ctx.require(routerPlugin)`)

| Method | Returns | Notes |
|---|---|---|
| `set(routes)` | `void` | Imperative (re-)registration — the declarative path is `pluginConfigs.router.routes`. Resolves `site`/`i18n` + the global `mode` at call time. Re-calling recompiles. |
| `match(pathname)` | `{ params, route } \| null` | Scans the specificity-sorted table; most specific wins. |
| `toUrl(name, params)` | `string` | Substitutes `{param}` / `{param:?}`; throws on an unknown name. |
| `entries()` | `readonly TypedRoute[]` | URL-utility view in **specificity** order (for `spa`/`head`). |
| `manifest()` | `readonly RouteDefinition[]` | Full definitions with `_handlers` (load/render/head/generate), in **declaration** order (for `build`). |
| `clientManifest()` | `readonly ClientRoute[]` | Specificity-sorted, JSON-serializable projection (`pattern`/`name`/`meta`, NO `_handlers`) for client shipping. |
| `mode()` | `"ssg" \| "spa" \| "hybrid"` | Resolved render mode — the single source of truth `build`/`spa` read to gate data nav. |

> Routes are normally provided declaratively via `pluginConfigs.router.routes` (compiled in the
> router's `onInit`). `set()` is the imperative runtime equivalent — use it to (re-)register routes
> after `createApp`, e.g. in a browser app that builds routes dynamically.

## Matching model

- Each route compiles to **two** `URLPattern` matchers: `withLang` (locale regex
  injected for `{lang:?}`) and `bare` (the `{lang:?}/` segment stripped). The
  match function tries `withLang` first; on a miss it falls back to `bare` and
  injects the `defaultLocale`.
- The `compiled` array is sorted ascending by `dynamicSegmentCount` (static beats
  dynamic; fewer dynamic segments win), with declaration order as a stable tiebreak.
- Numeric/regex group keys are stripped from extracted params.

## Generic-erasure mitigation

The route map passed to `app.router.set(routes)` is an opaque carrier
(`RouteMap = Record<string, RouteDefinition>`); per-route `TParams`/`TData` are erased at
that boundary. Type safety is a **call-site** property of `route()` + `defineRoutes()`, and
per-route definition types are recovered for build time via the `manifest()` **API return**.
See `__tests__/integration/route-types.test.ts` for the two proofs.

## Lifecycle

Routes are registered the normal config way via **`pluginConfigs.router.routes`**, compiled in the
router's **`onInit`**; or imperatively at runtime via **`app.router.set(routes)`**. Either path
validates (non-empty, well-formed patterns, ≤1 `{lang:?}`) and compiles the matcher table
synchronously into `ctx.state.table`, resolving `site`/`i18n` + the global render `mode` via
`ctx.require`/`ctx.global` at call time. `onInit` is the only lifecycle hook — it compiles the config
route map when present; there is no `onStart`/`onStop`, as the router manages no resource (a pure,
queryable matcher whose table is filled at init or by `set`).

## Files

- `index.ts` — wiring + `onInit` that compiles `config.routes` via `registerRoutes`.
- `builders/route-builder.ts` — `route()` fluent builder + `defineRoutes()` identity + `createUrls()` pure URL builder.
- `builders/compile.ts` — `validateRoutes`, `patternToUrlPattern`, `buildUrl`, `buildFilePath`, `compileRoutes`.
- `builders/match.ts` — `createMatchFunction`, `extractParams`, `matchRoute`.
- `api.ts` — `set` (compile the table) / `match` / `toUrl` / `entries` / `manifest` / `clientManifest` / `mode` closures.
- `state.ts` — the `{ table: null }` holder filled in `onInit`.
- `types.ts` — `ExtractRouteParams`, `RouteBuilder`, `RouteDefinition`, `RouteMap`, `TypedRoute`, `Urls<T>`, `CompiledRoute`, `MatcherTable`, `RouterConfig`, `RouterState`, `RouterApi`.
