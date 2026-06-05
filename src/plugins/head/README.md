# head

> Standard plugin — composes the document `<head>`: title, meta, OG/Twitter cards, canonical + hreflang, JSON-LD, and feed links. Pulled synchronously by `build` via `ctx.require`.

`head` owns everything rendered inside `<head>`. It is **PULL-only**: it emits no
events, subscribes to nothing, and hooks no lifecycle event. The `build` plugin pulls
it via `ctx.require(headPlugin).render(route, data)` to get a head HTML string at a
precise point in its synchronous render. `head` is pure compute and holds no resource
(no `onStart`/`onStop`); its only state is a normalized config snapshot frozen in `onInit`.

## API

### `render(route, data): string`

Composes the final `<head>` inner HTML for a route (no surrounding `<head>` tags).
Resolves `site`/`i18n`/`router` via `ctx.require` at call time. Composition order:

1. **Title** — `titleTemplate` (`%s`) applied to `route.head.title ?? site.name()`.
2. **Description + base meta** — `route.head.description ?? site.description()`.
3. **Open Graph + Twitter** — defaults merged with route-supplied values; `og:image`
   uses `route.head.image ?? defaultOgImage`, resolved against the site base URL.
4. **Canonical** — `route.head.canonical ?? site.canonical(router.toUrl(route))`.
5. **hreflang alternates** — one `<link rel=alternate hreflang>` per `i18n` locale plus
   `x-default`, each href built via `router.toUrl` for that locale.
6. **Route `elements`** — extra `HeadElement[]` from `.head()`, de-duplicated by `key`
   (later wins). All attribute/text values are HTML-escaped; JSON-LD is unicode-escaped.

### SEO primitive helpers (re-exported at the framework index)

Pure, context-free builders returning a `HeadElement` (`buildArticleHead` returns
`HeadElement[]`): `meta`, `og`, `twitter`, `jsonLd`, `canonical`, `hreflang`, `feedLink`,
`buildArticleHead`. Use them inside a route's `.head()` callback.

`jsonLd` is **XSS-safe**: it unicode-escapes `<`, `>`, and `&` (`<`, `>`,
`&`) so the payload can never break out of the `<script>` element, while still
round-tripping via `JSON.parse`.

## Configuration

Configured via `pluginConfigs.head`. All fields optional.

| Field            | Type                                   | Default                 | Notes                                            |
| ---------------- | -------------------------------------- | ----------------------- | ------------------------------------------------ |
| `titleTemplate`  | `string`                               | _(none)_                | Must contain `%s` (replaced by the route title). |
| `defaultOgImage` | `string`                               | _(none)_                | Fallback `og:image`; resolved against site base. |
| `twitterCard`    | `"summary" \| "summary_large_image"`   | `"summary_large_image"` | Emitted as `twitter:card`.                        |
| `twitterHandle`  | `string`                               | _(none)_                | Emitted as `twitter:site`.                        |

`onInit` validates structurally (no I/O): `titleTemplate` must contain `%s` and
`twitterCard` must be one of the two literals, otherwise it throws `[web] head: …`.

## Dependencies

`sitePlugin`, `i18nPlugin`, `routerPlugin` — all PULL (`ctx.require`) at render time.

## Shared compose module

The pure `(route, defaults, deps) → HeadElement[]` logic lives in `compose.ts` so the
`spa` plugin can reuse it (`spa → head`); `head` never imports `spa`.
