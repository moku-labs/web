# head

> **Isomorphic default** — composes the document `<head>` for a route: title template, canonical, OG/Twitter cards, JSON-LD, hreflang alternates, and feed links.

`head` owns everything rendered inside `<head>`. It is **PULL-only**: it emits no events, listens to nothing, and hooks no lifecycle event beyond `onInit`. The `build` plugin (on Node) and `spa` (in the browser) call `ctx.require(headPlugin).render(route, data)` to get the serialized `<head>` inner HTML at a precise point in their synchronous render. The single API method resolves its three dependencies — `site`, `i18n`, and `router` — fresh via `ctx.require` at call time, so it caches no subscription and holds no resource.

`head` is **pure compute** with no `onStart`/`onStop`. Its only state is a single frozen `defaults` snapshot, normalized once in `onInit` from `pluginConfigs.head`. The defining design decision: a `HeadElement` is a **plain serializable object, never a Preact `VNode`** — so `head` stays renderer-agnostic and produces the same descriptors whether they are serialized to a string at build time or applied to the live DOM. The pure composition core lives in `compose.ts` so `spa` can reuse it (the dependency direction is strictly `spa → head`; `head` never imports `spa`).

## Example

```ts
import { createApp } from "@moku-labs/web";
import { route } from "@moku-labs/web";
import { jsonLd, feedLink } from "@moku-labs/web";

// Global head defaults (all fields optional)
const app = createApp({
  pluginConfigs: {
    head: {
      titleTemplate: "%s — My Blog",
      twitterCard: "summary_large_image",
      twitterHandle: "@moku_labs",
      defaultOgImage: "/og-default.png"
    }
  }
});

// Per-route override via .head() — return a HeadConfig.
// Use the re-exported SEO primitives to add extra elements.
export const post = route("/posts/{slug}/")
  .render((ctx) => <Article data={ctx.data} />)
  .head((ctx) => ({
    title: ctx.data.title,            // → "<title>" via titleTemplate
    description: ctx.data.excerpt,
    image: ctx.data.cover,            // → og:image / twitter:image (absolutized)
    elements: [
      feedLink("My Blog", "/feed.xml"),
      jsonLd({ "@context": "https://schema.org", "@type": "Article", headline: ctx.data.title })
    ]
  }));
```

## API

Mounted at `app.head` (pull via `ctx.require(headPlugin)`).

| Method | Signature | Notes |
|---|---|---|
| `render` | `render(route: ResolvedRoute, data: unknown): string` | Composes and serializes the `<head>` **inner** HTML (no surrounding `<head>` tags). Pulls `site`/`i18n`/`router` via `ctx.require` at call time. Throws `[web] head: defaults accessed before onInit normalized them.` if reached before `onInit`. |

### Composition order (`render`)

1. **Title** — `titleTemplate` (`%s`) applied to `route.head.title ?? site.name()`.
2. **Description + base meta** — `route.head.description ?? site.description()`.
3. **Open Graph + Twitter** — defaults merged with route values; `og:image`/`twitter:image` use `route.head.image ?? defaultOgImage`, with relative paths absolutized against the site base URL. `twitter:card` from config; `twitter:site` only when `twitterHandle` is set; `og:locale` only when `i18n.ogLocale(route.locale)` resolves.
4. **Canonical** — `route.head.canonical ?? site.canonical(router.toUrl(route.name, route.params))`.
5. **hreflang alternates** — one `<link rel="alternate" hreflang>` per `i18n.locales()` (href built via `router.toUrl` with that locale as `lang`), plus an `x-default`.
6. **Route `elements`** — extra `HeadElement[]` from `.head()`, appended last.

Elements are then **de-duplicated by `key`, last-wins** — so a route-supplied element overrides the generated default at the same key, while keyless elements are always retained in order. On serialization, all attribute and `<title>` text values are HTML-escaped; JSON-LD `<script>` payloads are emitted verbatim (already unicode-escaped by `jsonLd`).

### SEO primitive helpers

Pure, context-free builders, each returning a serializable `HeadElement` (or `HeadElement[]`). They are registered as the plugin's `helpers` **and** re-exported at the framework index for direct use inside a route's `.head()` callback.

| Helper | Signature | Emits |
|---|---|---|
| `meta` | `meta(name: string, content: string)` | `<meta name content>` — key `meta:<name>` |
| `og` | `og(property: string, content: string)` | `<meta property content>` — key `meta:<property>` |
| `twitter` | `twitter(name: string, content: string)` | `<meta name content>` — key `meta:<name>` |
| `jsonLd` | `jsonLd(data: unknown)` | `<script type="application/ld+json">` — keyless |
| `canonical` | `canonical(url: string)` | `<link rel="canonical" href>` — key `link:canonical` |
| `hreflang` | `hreflang(locale: string, url: string)` | `<link rel="alternate" hreflang href>` — key `link:alternate:<locale>` |
| `feedLink` | `feedLink(title: string, url: string, type?: string)` | `<link rel="alternate" type title href>` — key `link:feed:<url>`; `type` defaults to `"application/rss+xml"` |
| `buildArticleHead` | `buildArticleHead(meta: ArticleMeta, canonicalUrl: string): HeadElement[]` | Canonical + `og:type=article` + published/modified/author/section/tag props + a JSON-LD `Article` block |

> [!NOTE]
> `jsonLd` is **XSS-safe**: it unicode-escapes `<`, `>`, and `&` (to `<`, `>`, `&`) so the payload can never break out of the `<script>` element, while still round-tripping through `JSON.parse`. `buildArticleHead` pushes `image` to `og:image` **verbatim** — pass an absolute URL, as it does not absolutize relative paths.

## Configuration

`pluginConfigs.head` — all fields optional. `onInit` validates structurally (no I/O) and throws `[web] head: …` on failure.

| Field | Type | Default | Notes |
|---|---|---|---|
| `titleTemplate` | `string` | _(none)_ | Must contain `%s` (replaced by the route title), else throws. |
| `defaultOgImage` | `string` | _(none)_ | Fallback `og:image`/`twitter:image`; relative paths resolved against the site base URL. |
| `twitterCard` | `"summary" \| "summary_large_image"` | `"summary_large_image"` | Emitted as `twitter:card`. Must be one of the two literals, else throws. |
| `twitterHandle` | `string` | _(none)_ | Emitted as `twitter:site` when present. |

## Dependencies

`depends: [sitePlugin, i18nPlugin, routerPlugin]` — all **PULL** via `ctx.require` at render time (resolved fresh on every `render`, never cached).

| Plugin | Slice consumed by `compose.ts` |
|---|---|
| [`site`](../site/README.md) | `name()`, `url()`, `description()`, `canonical(path)` — title/description/og fallbacks and absolute-URL resolution. |
| [`i18n`](../i18n/README.md) | `locales()`, `ogLocale(locale)` — drives the hreflang alternate set and `og:locale`. |
| [`router`](../router/README.md) | `toUrl(name, params)` — builds canonical and per-locale alternate hrefs. |

## Events

None. `head` neither emits nor listens to any event.

## Design notes

- **Renderer-agnostic descriptors.** `HeadElement` is a plain `{ tag, attrs?, children?, key? }` object, not a Preact `VNode` — so `head` pulls in no `preact` dependency and the same element set serializes to a string (build/SSG) or applies to the DOM (SPA) unchanged.
- **Shared pure core.** `composeHead` / `serializeHead` in `compose.ts` are pure `(route, defaults, deps) → HeadElement[] → string`. `spa` imports them directly to data-render on the client; `head` must never import `spa`.
- **Last-wins de-dup.** Generated defaults carry stable `key`s (`meta:<name>`, `link:canonical`, `link:alternate:<locale>`, …); a route-supplied element with the same key overrides the default. Keyless elements (e.g. `jsonLd`) are always kept.
- **`onInit` invariant.** State starts with `defaults: null`; `onInit` assigns the frozen normalized snapshot exactly once. `render` asserts non-null — reaching it before `onInit` is a programmer error and throws.
- **Escaping split.** Attribute values and `<title>` text are HTML-escaped at serialization; JSON-LD payloads are unicode-escaped at construction (`jsonLd`) and emitted verbatim, avoiding double-escaping.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Wiring harness: `depends`, `helpers`, `config`, `createState`, `api`, `onInit`; re-exports the 8 SEO primitives. |
| `types.ts` | `Config`, `State`, `HeadDefaults`, `HeadElement`, `HeadConfig`, `ArticleMeta`, `ResolvedRoute`, `Api`. |
| `api.ts` | `createApi` — the `render` method; reads frozen defaults and pulls `site`/`i18n`/`router`. |
| `config.ts` | `defaultConfig`, `validateHeadConfig`, `normalizeHeadConfig` (frozen snapshot). |
| `compose.ts` | Pure composition core: `composeHead`, `serializeHead` (+ dependency slice types). Reused by `spa`. |
| `primitives.ts` | The 8 pure SEO primitive helpers. |
| `helpers.ts` | `headHelpers` — bundles the primitives for the plugin `helpers` slot. |
| `state.ts` | `createState` — initializes `defaults` to `null`. |
| `__tests__/` | Unit tests (api, compose, primitives, state, types) + an integration test. |

---

<sub>Part of <strong><a href="../../../README.md">@moku-labs/web</a></strong> — built on <a href="https://github.com/moku-labs/core">@moku-labs/core</a>.</sub>
