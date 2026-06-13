# content

> **Node-only** — the Markdown content layer: discover article sources, parse YAML frontmatter, compute reading time, render to security-hardened HTML, and expose a locale-keyed `Article` model.

`content` owns the article model and its orchestration: locale fallback, draft filtering, date-descending sort, stable `contentId` assignment, the in-memory article cache, and notification events. It is **provider-driven** — exactly like `env`. The plugin *shell* (`api.ts`, `state.ts`, `config.ts`, `validate.ts`) imports zero node code and is browser-safe; all source I/O and the actual Markdown pipeline (gray-matter → unified → Shiki → sanitize) live in a [`ContentProvider`](#dependencies) you compose. The built-in `fileSystemContent` provider is the Node source — and the *only* module that touches `node:fs` and the pipeline — which is why this plugin is classed Node-only even though `contentPlugin` itself ships in the browser bundle.

Routes pull it via `ctx.require(contentPlugin)` inside build-only loaders, and apps reach it at `app.content`. It [depends on `i18n`](../i18n/README.md) for the active locale set and the default-locale fallback source. Lifecycle stance: **pure in-process compute** — `onInit` only (a fail-fast config check), no `onStart`/`onStop`. There is no live resource to warm or release; the costly unified/Shiki processor is a lazy singleton built on first use and parked inside the *provider's* closure, never on plugin state.

## Example

```ts
import { createApp, contentPlugin, fileSystemContent } from "@moku-labs/web";

const app = createApp({
  plugins: [contentPlugin], // node-only — add it explicitly for a build
  pluginConfigs: {
    i18n: { locales: ["en", "uk"], defaultLocale: "en" },
    content: {
      providers: [
        fileSystemContent({
          contentDir: "./content", // article root: content/<slug>/<locale>.md
          shikiTheme: "github-dark",
          defaultAuthor: "Ada"
        })
      ]
    }
  }
});

// All articles, per locale, date-descending (emits content:ready)
const byLocale = await app.content.loadAll();

// One article with locale fallback (uk → en) and full pipeline render
const article = await app.content.load("intro", "uk");
const card = app.content.articleToCard(article); // lightweight, no HTML
```

## API

Reached via `app.content` or `ctx.require(contentPlugin)`.

| Method | Signature | Notes |
|---|---|---|
| `loadAll` | `() => Promise<Map<string, Article[]>>` | Load every article across every active locale. Applies locale fallback, excludes drafts **in production only**, sorts date-descending, assigns `contentId`, caches, and emits `content:ready`. |
| `load` | `(slug: string, locale: string) => Promise<Article>` | Resolve + render one article with locale fallback. Throws a `[web] content` not-found error if neither the requested-locale nor default-locale file exists. In production a `draft` throws the **same** not-found error (drafts are indistinguishable from missing). |
| `renderMarkdown` | `(md: string) => Promise<string>` | Render a raw Markdown fragment to HTML through the full provider pipeline. |
| `invalidate` | `(paths: readonly string[]) => void` | Mark file paths stale for incremental dev rebuilds: fans invalidation to the provider and drops affected slugs from the cache. Empty/whitespace paths are ignored. Emits `content:invalidated`. |
| `articleToCard` | `(article: Article) => ArticleCard` | Pure projection of an `Article` to a lightweight card (no rendered HTML) for lists/grids. |
| `contentDir` | `() => string` | The configured content source directory (from the first provider, e.g. `"./content"`). Lets a build copy each article's co-located assets (`<contentDir>/<slug>/images/`). |

The `Article` model: `{ frontmatter, computed, html, locale, isFallback, url }`. `frontmatter` carries the authored fields (`title`, `date`, `description`, `tags`, `language`, optional `draft`/`author`); `computed` carries `{ slug, readingTime, contentId, status, wordCount }`. On fallback, `locale` and `url` stay the *requested* locale while `isFallback` is `true`.

## Configuration

`pluginConfigs.content` — one required field.

| Field | Type | Default | Notes |
|---|---|---|---|
| `providers` | `ContentProvider[]` | `[]` | Ordered content sources. Compose **at least one** (e.g. `fileSystemContent(...)`); the empty default is rejected at `onInit`. First provider to supply a slug+locale wins; `slugs()` are unioned across providers. |

Per-source options live on the provider, not here. The Node `fileSystemContent(options)` factory takes `FileSystemContentOptions`:

| Option | Type | Default | Notes |
|---|---|---|---|
| `contentDir` | `string` | — (required) | Absolute or project-relative path to the article root. |
| `trustedContent` | `boolean` | `false` | SECURITY GATE. When `false`, `rehype-sanitize` runs as the final step. Set `true` only for fully author-controlled Markdown — it skips sanitize entirely. |
| `shikiTheme` | `BundledTheme \| ThemeRegistrationAny` | `"github-dark"` | Passed straight to `@shikijs/rehype`. |
| `defaultAuthor` | `string` | `undefined` | Applied to articles whose frontmatter omits `author`. |
| `extraRemarkPlugins` | `readonly Pluggable[]` | `[]` | Concatenated **after** the framework remark defaults (additive — never replaces them). |
| `extraRehypePlugins` | `readonly Pluggable[]` | `[]` | Concatenated after the custom transforms, before Shiki + sanitize (additive). |
| `mermaid` | `boolean \| MermaidDiagramOptions` | disabled | Build-time [Mermaid diagrams](#mermaid-diagrams): render ```` ```mermaid ```` fences to static inline SVG. **Requires `trustedContent: true`** and the optional peer `mermaid-isomorphic`. |
| `embed` | `boolean` | disabled | [Lazy iframe embeds](#lazy-iframe-embeds): rewrite `::embed{src="…" title="…"}` directives to click-to-activate facades. **Requires `trustedContent: true`**. |

## Lazy iframe embeds

Opt-in rewriting of `::embed` leaf directives into **static click-to-activate facades** — the article never loads the embedded document (no request, no third-party JS, no scroll-jacking) until the reader clicks. The build emits only a `<figure class="lazy-embed">` carrying the target in data attributes plus an activation `<button>`; the companion **`lazyEmbed` SPA island** (exported from both entries, register it in `pluginConfigs.spa.components`) swaps the facade for the real `<iframe loading="lazy">` on click.

```md
<!-- External URL -->
::embed{src="https://game.example.com/" title="My Game"}

<!-- Co-located pre-built bundle, with a reserved portrait box -->
::embed{src="./game/index.html" title="My Game" width="400" height="711"}
```

```ts
// SSG side — enable the directive:
fileSystemContent({ contentDir: "./content", trustedContent: true, embed: true });

// Client side — register the activator island:
import { lazyEmbed } from "@moku-labs/web/browser";
createApp({ pluginConfigs: { spa: { components: [lazyEmbed] } } });
```

- **`trustedContent: true` is required.** The facade is raw HTML the sanitize pass would strip — and embedding third-party iframes is never safe for untrusted Markdown. `fileSystemContent` rejects the combination at construction.
- `src` and `title` are both **required**; a missing attribute fails the build. `src` may be:
  - an **http(s) URL** (`https://…`),
  - a **root-relative path** (`/games/x/`), or
  - a **co-located relative path** (`./game/index.html`, `../shared/game/`, `game/index.html`) pointing at a **pre-built** static bundle shipped next to the article — drop it at `content/<slug>/game/` exactly like the `images/` dir. The content-assets build phase copies **every** co-located subdirectory (not just `images/`; `.`/`_`-prefixed dirs are private and skipped) to `dist/<slug>/<dir>/`, and the relative `src` is resolved to the single shared `/<slug>/…` URL so it loads identically from every locale page. Nothing is bundled or transformed — the bundle ships as-is.
  - `javascript:`/`data:`/protocol-relative (`//host`) URLs fail the build.
- **Sizing (optional):** `width` and `height` (positive integers, **pixels**, set together) reserve the facade box at that aspect ratio via an inline `aspect-ratio` + `max-width` — so a portrait game frame holds its shape with **no layout shift** before activation. Omit both to let consumer CSS size the box.
- Facade markup: `<figure class="lazy-embed" data-component="lazy-embed" data-embed-src="…" data-embed-title="…"[ data-embed-width="…" data-embed-height="…" style="aspect-ratio: … / …; max-width: …px;"]>…facade inner…</figure>`. On activation the island injects `<iframe class="lazy-embed-frame" loading="lazy" allowfullscreen>` and sets `data-embed-active` on the figure. All visual chrome (`.lazy-embed*`, the activated state) is **consumer CSS** — the framework ships none.
- The `<figure>` data attributes are HTML-escaped; the iframe is granted `fullscreen; autoplay; gamepad`.

### Customizing the facade (a Preact component)

The framework owns the `<figure>` wrapper (island hooks + reserved-box sizing); the **inner content** is a Preact component you can replace via `embed.facade`. It is rendered to **static markup at build time** (no client JS, no hydration), receives the embed's options as props, and can read **any** extra directive attribute — so `::embed{… poster="/p.jpg" label="Play"}` flows straight into your component:

```tsx
import { createApp, EmbedFacadeButton, type EmbedFacadeProps } from "@moku-labs/web";

// A richer facade: a poster thumbnail above the default button.
function PosterFacade(props: EmbedFacadeProps) {
  return (
    <>
      {props.attributes.poster ? <img class="lazy-embed-poster" src={props.attributes.poster} alt="" /> : null}
      <EmbedFacadeButton {...props} />
    </>
  );
}

fileSystemContent({ contentDir: "./content", trustedContent: true, embed: { facade: PosterFacade } });
```

- `EmbedFacadeProps` = `{ src, title, width?, height?, attributes }` — `attributes` is the full raw directive bag (your custom options live there). Exported type.
- `EmbedFacadeButton` is the **default** inner content, exported so you can compose it (wrap it, or place it alongside your own markup) instead of reimplementing.
- The island activates on a click **anywhere** in the facade, so custom markup needs no wiring; include a focusable control (the default `<button>`) for keyboard users.
- The facade is build-time SSR only — it is never hydrated. Keep it presentational (no event handlers, no client state); interactivity arrives with the activated iframe.

## Mermaid diagrams

Opt-in, **build-time** rendering of ```` ```mermaid ```` fenced code blocks to static inline SVG — the published page ships zero client-side Mermaid JS. Rendering is delegated to the **optional** peer dependency [`mermaid-isomorphic`](https://github.com/remcohaszing/mermaid-isomorphic) (a headless browser under the hood), which is imported **lazily and only when a document actually contains a mermaid fence** — consumers who never write diagrams pay nothing.

```ts
fileSystemContent({
  contentDir: "./content",
  trustedContent: true, // REQUIRED — see below
  mermaid: true // or: { mermaidConfig: { theme: "dark" } }
});
```

Install the optional dependencies (only apps that enable `mermaid` need this):

```sh
bun add -d mermaid-isomorphic playwright && bunx playwright install chromium
```

- **`trustedContent: true` is required.** Mermaid output is raw inline SVG, which the sanitize pass (the untrusted-content XSS boundary) would strip — `fileSystemContent` rejects the combination at construction. Enable it only for fully author-controlled Markdown.
- Each diagram renders into `<figure class="mermaid-diagram">…<svg …></figure>` — style the wrapper via that class.
- The transform runs at the **mdast** stage, before the remark-rehype bridge, so Shiki never claims the fence; all fences of a document are rendered in **one** batched renderer call, and the renderer (browser) is created once per process.
- A diagram that fails to render **fails the build** with its first line quoted — a broken diagram never ships silently.
- `mermaidConfig` is passed straight through to mermaid-isomorphic's render call (loosely typed `Record<string, unknown>` because the dependency is optional).

## Dependencies

`depends: [i18nPlugin]`. The shell PULLs the `i18n` API via `ctx.require(i18nPlugin)` for `locales()` (which locales `loadAll` iterates) and `defaultLocale()` (the fallback source for `load`). See [`../i18n/README.md`](../i18n/README.md).

`ContentProvider` is the composition seam the shell drives:

| Member | Signature | Role |
|---|---|---|
| `name` | `string` | Human-readable, used in diagnostics. |
| `contentDir` | `string` | Surfaced via `api.contentDir()` (`""` for non-filesystem sources). |
| `slugs` | `() => Promise<readonly string[]>` | Discover the slugs this provider can supply. |
| `readArticle` | `(slug, fileLocale, outLocale, isFallback) => Promise<Article \| null>` | Read + render one article; `null` when absent. |
| `render` | `(markdown: string) => Promise<string>` | Render a standalone Markdown string. |
| `invalidate?` | `(paths: readonly string[]) => void` | Optional dev hook to drop stale discovery. |

When more than one provider is composed, the shell collapses them into a single facade: `slugs()` are unioned and sorted, `readArticle`/`render` use first-match, `invalidate` fans out. A single-provider list (the common case) is used directly.

## Events

Notification-only — fetch real data via the API, never off the payload.

| Event | Payload | Emitted by |
|---|---|---|
| `content:ready` | `{ locales: readonly string[]; articleCount: number }` | end of every `loadAll()` |
| `content:invalidated` | `{ paths: readonly string[] }` | every `invalidate(paths)` (only the accepted, non-empty paths) |

## Design notes

### The sanitize-last XSS boundary (`trustedContent`)

`rehype-sanitize` runs as the **last** rehype step — after Shiki highlighting — whenever `trustedContent: false` (the default). Sanitizing last means even the markup Shiki emits is scrubbed, and dangerous payloads (`<script>`, `onerror=`, `javascript:` URLs) are stripped from the output. The extended schema (`pipeline/sanitize.ts`) clones the library default and *additively* allowlists exactly what the framework transforms produce: the `pull-quote`, `section-divider`, and `section-divider-ornament` classes on `aside`/`div`/`span`, `loading="lazy"` on `<img>`, and `class`/`className` globally (`*`) so Shiki's class hooks survive. `style` is deliberately **not** allowed globally — CSS values are not sanitized, so untrusted `style` attributes would enable overlay/exfiltration tricks; it survives only on `pre`/`code` (Shiki's block-level theme colors). Shiki's per-token inline `span` colors are therefore stripped when `trustedContent: false`; use `trustedContent: true` only for fully author-controlled content if you need them.

> [!WARNING]
> `trustedContent: true` **skips** sanitize entirely and trusts all raw HTML in the source. Use it only when the framework author controls 100% of the Markdown (no user-submitted content).

### Additive `extraRemarkPlugins` / `extraRehypePlugins`

The framework default remark/rehype arrays are **hardcoded** in `pipeline/plugins.ts` (wired by `pipeline/markdown.ts`) — never a config-array default. A full-array config key would be *replaced*, not merged, by the shallow plugin-config merge, silently erasing the framework pipeline. Keeping defaults out of config and exposing only additive `extra*` keys means consumer extras are **concatenated** after the defaults, never able to wipe them.

### Lazy processor singleton (in the provider)

The Shiki/unified processor is a **lazy singleton stored on the provider's private `ContentProviderState.processor`** — never on the shell's `ctx.state`, never a module-level cache. It is built on the first `render()`/`readArticle()` via `ensureProcessor(state, options)` inside `fileSystemContent`, then reused. Because it lives in the provider closure, two apps in one process never share one (no cross-app Shiki leak), and `createState`/`onInit` do no async work, keeping `createApp` synchronous.

### Locale fallback & draft filtering (stage-gated)

`load(slug, locale)` prefers the native `<contentDir>/<slug>/<locale>.md` (`isFallback: false`); when absent it falls back to the default-locale file (`isFallback: true`, requested locale retained on `locale`/`url`). Drafts (frontmatter `draft: true` → `computed.status === "draft"`) are excluded by `loadAll` and `load` **only when `global.stage === "production"`** — they load normally in `development` and `test`. In production a draft surfaces as the *identical* not-found error a missing article does, so drafts cannot be probed.

### Computed fields

`readingTime` is `reading-time`'s estimate, `Math.ceil`-ed with a 1-minute floor; `wordCount` is its raw word count. `contentId` is the slug on read, then rewritten by `loadAll` to a sortable `${locale}:${index4}:${slug}` *after* the date sort. `fileSystemContent` also rewrites co-located relative image `src`s (`./images/…` → `/<slug>/images/…`) so they resolve from any locale page. Frontmatter `Date` values are coerced to ISO `YYYY-MM-DD` (avoiding timezone shift), and the five required fields throw a `[web] content` error if missing.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Wiring harness only (`depends`, `events`, `config`, `createState`, `onInit`, `api`). |
| `types.ts` | `Config`, `State`, `Api`, `Article`, `ArticleCard`, `Frontmatter`, `ComputedFields`, `ContentProvider`, `FileSystemContentOptions`, `MermaidDiagramOptions`, `ContentEvents`, `ContentApiContext`. |
| `config.ts` | `defaultContentConfig` — `{ providers: [] }`. |
| `events.ts` | `contentEvents` register callback. |
| `validate.ts` | `validateContentConfig` — `onInit` fail-fast when no provider is composed — + `validateFileSystemContentOptions` (mermaid ⇒ trustedContent). |
| `state.ts` | `createContentState` — the empty locale-keyed article cache. |
| `api.ts` | `contentApi` (kernel-facing) + `createContentApi` (kernel-free) + `mergeProviders`. All orchestration: fallback, draft filtering, sort, cache, events. Imports zero node code. |
| `providers.ts` | `fileSystemContent` — the Node provider (`node:fs` + pipeline). Root export only, never `/browser`. |
| `pipeline/markdown.ts` | `ensureProcessor` — lazy builder, sanitize-last, extra-plugin concat. |
| `pipeline/plugins.ts` | Framework default remark/rehype arrays + the 3 custom transforms (lazy-images, pull-quote, section-divider). |
| `pipeline/frontmatter.ts` | `parseFrontmatter` (gray-matter, `Date`→ISO, required-field + default handling). |
| `pipeline/reading-time.ts` | `calculateReadingTime`. |
| `pipeline/sanitize.ts` | `buildSanitizeSchema` — the extended rehype-sanitize schema. |
| `pipeline/mermaid.ts` | `remarkMermaidDiagrams` — opt-in build-time mermaid fences → inline SVG (lazy optional dep). |

> [!NOTE]
> The shell (`contentPlugin`) is re-exported from `@moku-labs/web/browser` so build-only loaders can `ctx.require(contentPlugin)` on either side, while `fileSystemContent` is exported **only** from the package root — mirroring the node `env` providers (`dotenv`/`processEnv`).

---

<sub>Part of <strong><a href="../../../README.md">@moku-labs/web</a></strong> — built on <a href="https://github.com/moku-labs/core">@moku-labs/core</a>.</sub>
