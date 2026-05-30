# router plugin

> **Tier:** Complex (`builders/` sub-domain) · **Depends on:** `site`, `i18n` · Wave 2

The single source of truth for the framework's route table: a typed, fluent
route-builder DSL (`route()`), a route-map identity helper (`defineRoutes()`),
compile-time path-param inference (`ExtractRouteParams`), and a runtime matcher
(`match`, `toUrl`, `entries`, `manifest`). Downstream plugins (`build`, `head`,
`spa`) consult it via `ctx.require(routerPlugin)` — never via config readback.

## Public surface

```ts
import { createApp, defineRoutes, route } from "@moku-labs/web";

const routes = defineRoutes({
  home: route("/").render(() => <Home />),
  article: route("/{lang:?}/{slug}/")
    .load(({ slug }) => loadArticle(slug)) // typed → ctx.data
    .render((ctx) => <Article article={ctx.data} />)
    .head((ctx) => ({ title: ctx.data.title }))
});

const app = createApp({
  pluginConfigs: {
    site: { name: "Blog", url: "https://blog.dev", author: "Alex", description: "…" },
    i18n: { locales: ["en", "uk"], defaultLocale: "en" },
    router: { routes }
  }
});
```

## API (`ctx.require(routerPlugin)`)

| Method | Returns | Notes |
|---|---|---|
| `match(pathname)` | `{ params, route } \| null` | Scans the specificity-sorted table; most specific wins. |
| `toUrl(name, params)` | `string` | Substitutes `{param}` / `{param:?}`; throws on an unknown name. |
| `entries()` | `readonly TypedRoute[]` | URL-utility view in **specificity** order (for `spa`/`head`). |
| `manifest()` | `readonly RouteDefinition[]` | Full definitions with `_handlers`, in **declaration** order (for `build`). |

## Matching model

- Each route compiles to **two** `URLPattern` matchers: `withLang` (locale regex
  injected for `{lang:?}`) and `bare` (the `{lang:?}/` segment stripped). The
  match function tries `withLang` first; on a miss it falls back to `bare` and
  injects the `defaultLocale`.
- The `compiled` array is sorted ascending by `dynamicSegmentCount` (static beats
  dynamic; fewer dynamic segments win), with declaration order as a stable tiebreak.
- Numeric/regex group keys are stripped from extracted params.

## Generic-erasure mitigation

`pluginConfigs.router.routes` is an opaque carrier (`RouteMap = Record<string, RouteDefinition>`);
the framework `Config` generic erases per-route `TParams`/`TData`. Type safety is a
**call-site** property of `route()` + `defineRoutes()`, and per-route definition
types are recovered for build time via the `manifest()` **API return** — not config
readback. See `__tests__/integration/route-types.test.ts` for the two proofs.

## Lifecycle

`onInit` validates (non-empty, well-formed patterns, ≤1 `{lang:?}`) and compiles
the matcher table synchronously into `ctx.state.table`. There is **no** `onStart`
/`onStop` — the router manages no resource (it is a pure, queryable matcher).

## Files

- `index.ts` — wiring only (≤30 lines).
- `builders/route-builder.ts` — `route()` fluent builder + `defineRoutes()` identity.
- `builders/compile.ts` — `validateRoutes`, `patternToUrlPattern`, `buildUrl`, `buildFilePath`, `countDynamicSegments`, `compileRoutes`, `buildRouterTable`.
- `builders/match.ts` — `createMatchFunction`, `extractParams`, `matchRoute`.
- `api.ts` — `match` / `toUrl` / `entries` / `manifest` closures.
- `state.ts` — the `{ table: null }` holder filled in `onInit`.
- `types.ts` — `ExtractRouteParams`, `RouteBuilder`, `RouteDefinition`, `RouteMap`, `TypedRoute`, `CompiledRoute`, `MatcherTable`, `RouterConfig`, `RouterState`, `RouterApi`.
