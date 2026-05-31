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

const routes = defineRoutes({
  home: route("/")
    .render(() => <h1>My Blog</h1>)
    .head(() => ({ title: "My Blog" })),
  article: route("/{lang:?}/{slug}/")
    .generate((locale) => listSlugs(locale).map((slug) => ({ lang: locale, slug })))
    .load(({ slug }, locale) => loadArticle(slug, locale)) // widens ctx.data
    .render((ctx) => <Article article={ctx.data} />)
    .head((ctx) => ({ title: ctx.data.title, description: ctx.data.description }))
});

const app = createApp({
  plugins: [contentPlugin, buildPlugin, deployPlugin], // node-only — added per target
  config: { mode: "production" },
  pluginConfigs: {
    env: { providers: [dotenv(), processEnv()] },
    site: { name: "My Blog", url: "https://blog.dev", author: "Me", description: "A personal blog." },
    i18n: { locales: ["en", "uk"], defaultLocale: "en" },
    content: { contentDir: "./content" },
    router: { routes, mode: "ssg" },
    head: { titleTemplate: "%s — My Blog" },
    build: { outDir: "dist", feeds: true, sitemap: true }
  }
});

await app.build.run(); // → static site in dist/ (HTML, feed.xml, sitemap.xml)
```

Content lives on disk as `content/{slug}/{locale}.md` with YAML frontmatter
(`title`, `date`, `description`, `tags`, `language`, optional `draft`/`author`). Drafts are excluded
from production builds.

## Composition model

`createApp`'s **defaults are the isomorphic plugins** — the ones that run unchanged on
both Node and the browser: `site`, `i18n`, `router`, `head`, `spa` (plus the `log`/`env`
core). The **node-only** plugins (`content`, `build`, `deploy`) are exported but not
defaults — add them with `createApp({ plugins: [...] })` for a Node build, and omit them
in a browser app (with `"sideEffects": false`, your bundler tree-shakes them out). You
also choose the `env` provider per target: `[dotenv(), processEnv()]` on Node,
`[browserEnv()]` in the browser. The framework never hard-blocks either runtime.

`data` is a special case — an **optional isomorphic bridge**: composed on Node it
`emit()`s static JSON (route-index + per-route sidecars); composed in the browser its
`load()` lets `spa` navigate by fetching that JSON instead of full HTML. Add it on both
sides when you want JSON-driven navigation; omit it for a plain static site.

A browser entry is just your own `createApp(...).start()` over the defaults (plus
`dataPlugin` if you want JSON nav) — `spa`'s `onStart` mounts islands onto the SSR'd DOM
and intercepts navigation.

## Plugins

| Plugin | Default? | Responsibility |
|---|---|---|
| `site` | ✅ isomorphic | Site identity (name, URL, author) + canonical URL helper |
| `i18n` | ✅ isomorphic | Locales, default-locale fallback, translations, hreflang/ogLocale maps |
| `router` | ✅ isomorphic | Type-safe route DSL (`route`/`defineRoutes`), matching, URL/file derivation |
| `head` | ✅ isomorphic | SEO `<head>` composition: title template, canonical, OG/Twitter, JSON-LD, hreflang |
| `spa` | ✅ isomorphic | Client runtime: island hydration + intercepted navigation (inert on Node) |
| `content` | ➕ node-only | Markdown pipeline → sanitized HTML, frontmatter, reading time, locale model |
| `build` | ➕ node-only | SSG orchestrator: pages, feeds (RSS/Atom/JSON), sitemap, OG images |
| `deploy` | ➕ node-only | Cloudflare Pages: `wrangler.jsonc` scaffolding + deploy |
| `data` | ➕ optional bridge | Isomorphic: Node `emit()` writes route-index + JSON sidecars; browser `load()` feeds `spa` JSON-driven nav |
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
