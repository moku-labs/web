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
import { createApp, defineRoutes, route } from "@moku-labs/web";

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
  config: { mode: "production" },
  pluginConfigs: {
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

## Plugins

| Plugin | Responsibility |
|---|---|
| `site` | Site identity (name, URL, author) + canonical URL helper |
| `i18n` | Locales, default-locale fallback, translations, hreflang/ogLocale maps |
| `router` | Type-safe route DSL (`route`/`defineRoutes`), matching, URL/file derivation |
| `content` | Markdown pipeline → sanitized HTML, frontmatter, reading time, locale model |
| `head` | SEO `<head>` composition: title template, canonical, OG/Twitter, JSON-LD, hreflang |
| `build` | SSG orchestrator: pages, feeds (RSS/Atom/JSON), sitemap, OG images |
| `spa` | Client runtime: island hydration + intercepted navigation |
| `deploy` | Cloudflare Pages: `wrangler.jsonc` scaffolding + deploy |
| `log`, `env` | Core plugins: structured logging + validated environment access |

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
