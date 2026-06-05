# @moku-labs/web

**A content static-site generator + SPA web framework for TypeScript.** Built on
[@moku-labs/core](https://github.com/moku-labs/core) — three layers of isolation, plugins all the
way down, types doing the heavy lifting.

```
bun add @moku-labs/web
```

> Status: `0.1.0` — early. The API is settling but not yet frozen.

---

## What it is

`@moku-labs/web` composes a small set of focused plugins into one framework: author Markdown
content, declare type-safe routes, generate SEO-complete HTML + feeds + sitemap at build time, and
optionally hydrate islands and deploy to Cloudflare Pages.

The consumer surface is one `createApp` call plus a typed routing DSL — you never import from
`@moku-labs/core` directly.

## Quick start

```ts
// A Node SSG build — compose the node-only plugins explicitly:
import {
  createApp,
  defineRoutes,
  route,
  contentPlugin,
  buildPlugin,
  deployPlugin,
  dotenv,
  processEnv
} from "@moku-labs/web";

// routes.tsx — loaders pull sibling APIs the spec way (ctx.require); links via ctx.url
export const home = route("/")
  .render(() => <h1>My Blog</h1>)
  .head(() => ({ title: "My Blog" }));
export const article = route("/{lang:?}/{slug}/")
  .generate((ctx) => listSlugs(ctx.locale).map((slug) => ({ lang: ctx.locale, slug })))
  .load((ctx) => ctx.require(contentPlugin).load(ctx.params.slug, ctx.locale)) // widens ctx.data
  .render((ctx) => <Article article={ctx.data} url={ctx.url} />)
  .head((ctx) => ({ title: ctx.data.title, description: ctx.data.description }));

// app.ts — create (routes via config) → run
import * as routes from "./routes";

const app = createApp({
  plugins: [contentPlugin, buildPlugin, deployPlugin], // node-only — added per target
  config: { mode: "ssg" },                             // GLOBAL render mode: "ssg" | "spa" | "hybrid"
  pluginConfigs: {
    env: { providers: [dotenv(), processEnv()] },
    site: { name: "My Blog", url: "https://blog.dev", author: "Me", description: "A personal blog." },
    i18n: { locales: ["en", "uk"], defaultLocale: "en" },
    content: { contentDir: "./content" },
    router: { routes },                                // declarative route map (an `import * as` namespace works)
    head: { titleTemplate: "%s — My Blog" },
    build: { outDir: "dist", feeds: true, sitemap: true }
  }
});

await app.build.run();   // → static site in dist/ (HTML, feed.xml, sitemap.xml); routes compiled at init
// Runtime (re-)registration alternative: app.router.set(routes)
```

Content lives on disk as `content/{slug}/{locale}.md` with YAML frontmatter
(`title`, `date`, `description`, `tags`, `language`, optional `draft`/`author`). Drafts are excluded
from production builds.

## Composition model

`createApp`'s **defaults are the isomorphic plugins** — the ones that run unchanged on
both Node and the browser: `site`, `i18n`, `router`, `head`, `spa` (plus the `log`/`env`
core). The **node-only** plugins (`content`, `build`, `deploy`) are exported but not
defaults — add them with `createApp({ plugins: [...] })` for a Node build. You also choose
the `env` provider per target: `[dotenv(), processEnv()]` on Node, `browserEnv()` in the
browser. The framework never hard-blocks either runtime.

Two entry points pick the right surface per target:

- **`@moku-labs/web`** (the `.` entry, dual ESM+CJS) — the full surface, for **Node SSG
  builds**: add `contentPlugin`/`buildPlugin`/`deployPlugin` and wire `dotenv()`/`processEnv()`.
- **`@moku-labs/web/browser`** (ESM-only) — the recommended **client/browser** entry. It
  re-exports the SAME `createApp`/`createPlugin` over the SAME isomorphic default set
  (`site`, `i18n`, `router`, `head`, `spa` + `log`/`env`), plus `dataPlugin`, `defineRoutes`,
  `route`, `createUrls`, `createComponent`, `browserEnv`, the SEO head primitives, and the browser-relevant type namespaces
  (`Data`, `Env`, `Head`, `Log`, `Router`, `Spa`). It **excludes** everything node-only
  (`contentPlugin`, `buildPlugin`, `deployPlugin`, the `dotenv`/`processEnv`/`cloudflareBindings`
  env providers, and the `Build`/`Content`/`Deploy` type namespaces), and **pre-wires
  `browserEnv()`** as the default env provider — so `env` works with **zero** consumer
  config (no `pluginConfigs.env.providers` needed), resolving from `import.meta.env` and
  `globalThis.__ENV__`.

Importing `@moku-labs/web/browser` can **never** drag node/native code into a client bundle,
regardless of your bundler or tree-shaking — its static import graph references zero
node-only modules. This is stronger and more reliable than importing `@moku-labs/web` and
relying on `"sideEffects": false` tree-shaking, which is fragile (building entries together
can merge node code into a shared chunk). A CI gate (`bun run check:bundle`) asserts the
built browser bundle has zero static node/native imports and stays under a gzip size budget
(the browser bundle is currently ~35 kB gzip).

`data` is a special case — an **optional, domain-agnostic data provider**: composed on
Node, `build` calls `data.write(...)` to persist each page's real `load()` output as JSON
(one file per page URL); composed in the browser, `data.at(path)` fetches that JSON and
`spa` re-runs the route's own `render` from it instead of fetching full HTML. The route owns rendering — the SAME `render` runs at
build (SSG) and on the client, so parity is structural. Add `data` on both sides for
client DATA navigation; omit it for a plain static site (HTML-over-fetch).

The single switch is the global **`config.mode`** (`"ssg" | "spa" | "hybrid"`, read by
plugins via `router.mode()`): `build` writes data + `spa` data-renders only when it is not
`"ssg"`. On a client nav the fetched JSON (which the build wrote from `load()`) is used
directly as `ctx.data` — no validation step; a missing or malformed file simply falls back
to HTML-over-fetch. `ctx.data` is typed from `.load()`'s return. A route may also omit
`.load()` entirely (a static page); `build` still emits an empty `{}` data sidecar so hybrid
nav resolves cleanly.

A browser entry is `createApp(...).start()` imported from `@moku-labs/web/browser` over the
defaults (plus `dataPlugin` for DATA nav) — `spa`'s `onStart` mounts islands onto the SSR'd
DOM and intercepts navigation. `dataPlugin` stays consumer-composed (it is not a default):
compose it for client DATA navigation (`router.mode` `"spa"` | `"hybrid"`); its node
write-half is loaded only via dynamic import.

```ts
// A browser bundle — guaranteed node-free, env pre-wired:
import { createApp, dataPlugin } from "@moku-labs/web/browser";
import * as routes from "./routes"; // render shells only — no node-only content import

// env works with no wiring — browserEnv is the default provider
const app = createApp({ plugins: [dataPlugin], config: { mode: "spa" }, pluginConfigs: { router: { routes } } });
await app.start(); // routes compiled at init (or app.router.set(routes) at runtime)
```

## Plugins

| Plugin | Default? | Responsibility |
|---|---|---|
| `site` | ✅ isomorphic | Site identity (name, URL, author) + canonical URL helper |
| `i18n` | ✅ isomorphic | Locales, default-locale fallback, translations, hreflang/ogLocale maps |
| `router` | ✅ isomorphic | Type-safe route DSL (`route`) — optional `.load` (gets `ctx.require`/`has`), `.render`/`.head` (get `ctx.url`), `.generate`; routes registered via `pluginConfigs.router.routes` (or `app.router.set(routes)` at runtime); matching, `mode()` (from global config), URL/file derivation |
| `head` | ✅ isomorphic | SEO `<head>` composition: title template, canonical, OG/Twitter, JSON-LD, hreflang |
| `spa` | ✅ isomorphic | Client runtime: island hydration + intercepted navigation (inert on Node) |
| `content` | ➕ node-only | Markdown pipeline → sanitized HTML, frontmatter, reading time, locale model |
| `build` | ➕ node-only | SSG orchestrator: pages, feeds (RSS/Atom/JSON), sitemap, OG images |
| `deploy` | ➕ node-only | Cloudflare Pages: `wrangler.jsonc` scaffolding + deploy |
| `cli` | ➕ node-only | Developer CLI — `build`/`serve`/`preview`/`deploy` with a boxed Panel renderer + live build progress; driven from thin per-command scripts (deploy confirm is TTY-only, CI auto-proceeds) |
| `data` | ➕ optional provider | Agnostic: Node `write()` persists per-page JSON (keyed by URL); browser `at()` fetches it for `spa` DATA nav (used directly as `ctx.data`) |
| `log`, `env` | ✅ core | Structured logging + validated environment access |

SEO primitives are exported for route `.head()` handlers: `meta`, `og`, `twitter`, `jsonLd`,
`canonical`, `hreflang`, `feedLink`, `buildArticleHead`.

## Scripts

```
bun run build     # build with tsdown
bun run test      # vitest (unit + integration)
bun run lint      # biome + eslint
```

## License

MIT © moku-labs
