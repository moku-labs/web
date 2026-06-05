# content

> Complex plugin — Markdown content pipeline: discover article source files, parse YAML frontmatter, compute reading time, render to security-hardened HTML through a [unified](https://unified.js.org/) processor, and expose a locale-keyed `Article` model. Depends on `i18n` for active locales and default-locale fallback.

## API

| Method | Signature | Purpose |
|--------|-----------|---------|
| `loadAll` | `() => Promise<Map<string, Article[]>>` | Load every article across every active locale, date-descending. Emits `content:ready`. |
| `load` | `(slug, locale) => Promise<Article>` | Resolve + render one article with locale fallback. Throws `[web] content ...` if neither the requested nor default-locale file exists. |
| `renderMarkdown` | `(md) => Promise<string>` | Render a raw Markdown fragment to HTML through the full pipeline. |
| `invalidate` | `(paths) => void` | Mark file paths stale for incremental dev rebuilds. Emits `content:invalidated`. |
| `articleToCard` | `(article) => ArticleCard` | Pure projection of an `Article` to a lightweight card (no HTML). |

### Events

- `content:ready` — `{ locales, articleCount }` — emitted at the end of every `loadAll()`. Notification-only; fetch data via `loadAll()`, not off the event.
- `content:invalidated` — `{ paths }` — emitted on every `invalidate(paths)`.

## Configuration

```ts
import { contentPlugin, fileSystemContent } from "@moku-labs/web";

createApp({
  plugins: [contentPlugin],
  pluginConfigs: {
    content: {
      // The content plugin SHELL is browser-safe (orchestration only). Source I/O +
      // the Markdown pipeline live in a provider you compose — mirrors `env` providers.
      providers: [
        fileSystemContent({
          contentDir: "./src/content",  // article root: content/<slug>/<locale>.md
          trustedContent: false,         // SECURITY GATE — see below
          shikiTheme: "github-dark",
          defaultAuthor: "Alex",         // optional; applied when frontmatter omits author
          extraRemarkPlugins: [],        // additive — concatenated AFTER framework defaults
          extraRehypePlugins: []         // additive — concatenated AFTER custom transforms
        })
      ]
    }
  }
});
```

Compose at least one provider (validated at `onInit`); every `fileSystemContent` option has a
default except `contentDir` (required) and `defaultAuthor` (resolves to `undefined`). On the browser,
`contentPlugin` (the shell) is importable from `@moku-labs/web/browser` for `ctx.require(contentPlugin)`
in build-only loaders, while `fileSystemContent` (node) is exported only from the package root.

## Key invariants

### The sanitize-last XSS boundary (`trustedContent`)

`rehype-sanitize` runs as the **last** rehype step — after Shiki highlighting — whenever
`trustedContent: false` (the default). Sanitizing last means even the markup Shiki
generates is scrubbed, and dangerous payloads (`<script>`, `onerror=`, `javascript:`
URLs) are stripped from rendered HTML.

Setting `trustedContent: true` **skips** the sanitize step entirely and trusts all raw
HTML in the source. Use it **only** when the framework author controls 100% of the
Markdown (no user-submitted content). The extended sanitize schema additively
allowlists exactly the markup the framework transforms emit: the `pull-quote`,
`section-divider`, and `section-divider-ornament` classes, and `loading="lazy"` on
`<img>`.

### Additive `extraRemarkPlugins` / `extraRehypePlugins`

The framework default remark/rehype plugin arrays are **hardcoded** in
`pipeline/plugins.ts` (and wired by `pipeline/markdown.ts`) — never exposed as a
config-array default. A consumer-facing full-array config key would be **replaced**,
not merged, by the shallow merge (spec/05 §3), silently erasing the framework
pipeline. The additive `extraRemarkPlugins` / `extraRehypePlugins` keys avoid this:
defaults are never in config, so they cannot be replaced; consumer extras are
**concatenated** after the defaults at processor-build time.

### Lazy processor singleton on `ctx.state`

The Shiki/unified processor is a **lazy singleton stored on `ctx.state.processor`** —
never a module-level cache. It is built on the first `loadAll()` / `renderMarkdown()`
via `ensureProcessor(state, config)`, then reused for every article in that app. Because
state is per-app, two apps in one process never share a processor (no cross-app Shiki
leak). `createState`/`onInit` do no async work, keeping `createApp` synchronous.

### Locale fallback & draft filtering

`load(slug, locale)` prefers the native `content/<slug>/<locale>.md`
(`isFallback: false`); when absent it falls back to the default-locale file
(`isFallback: true`, requested locale retained on `locale`/`url`). `loadAll()` excludes
articles whose status is `draft` only when `ctx.global.mode === "production"`.

## Structure

```
content/
  index.ts             # wiring harness only
  types.ts             # Config, State, Api, Article, Frontmatter, ArticleCard, ContentEvents, ContentApiContext
  config.ts            # defaultContentConfig
  events.ts            # contentEvents register callback
  validate.ts          # validateContentConfig (onInit fail-fast)
  state.ts             # createContentState — empty containers, null processor
  api.ts               # contentApi + createContentApi (loadAll/load/renderMarkdown/invalidate/articleToCard + loader/invalidate logic)
  pipeline/
    markdown.ts        # ensureProcessor — lazy builder, sanitize-last, extra-plugin concat
    frontmatter.ts     # parseFrontmatter (gray-matter, Date→ISO, defaults)
    reading-time.ts    # calculateReadingTime
    plugins.ts         # framework default remark/rehype arrays + the 3 custom transforms
    sanitize.ts        # extended rehype-sanitize schema
```

> Lifecycle: no `onStart`/`onStop` — the plugin is pure in-process compute with no
> live resource to warm or release; the lazy processor is created on first use.
