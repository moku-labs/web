# site

> **Isomorphic default** — the single source of truth for the framework's global, frozen site identity (name, URL, author, description) and the canonical-URL helper.

`site` owns the four pieces of global site metadata — `name`, `url`, `author`, `description` — and the `canonical(path)` helper that joins a relative path against the base `url`. Those four config fields **are** its entire data model: validated once at `onInit` (fail-fast at `createApp`) and read-only thereafter. The plugin holds no mutable state, declares no `depends`, and emits no events.

Other plugins PULL it via `ctx.require(sitePlugin)`; for the consumer the same API is mounted at `app.site`. `router`, `head`, and `build` (and indirectly feeds/sitemap/SEO) read `.name()`, `.url()`, `.author()`, `.description()`, and `.canonical(path)`. Its lifecycle stance is minimal: pure synchronous config + compute, `onInit` only (a validation pass that allocates nothing), no `onStart`/`onStop` — every value is available the moment the app is constructed, so there is nothing to start or tear down. The one load-bearing design decision: there are no usable defaults. The framework ships empty-string placeholders only to keep the type a complete `Config`; the real values are site-identity that only the consumer knows, so `onInit` throws unless they are supplied.

## Example
```ts
import { createApp } from "@moku-labs/web";

const app = createApp({
  pluginConfigs: {
    site: {
      name: "My Blog",
      url: "https://blog.dev",
      author: "Ada Lovelace",
      description: "Notes on computing"
    }
  }
});

app.site.name();               // "My Blog"
app.site.url();                // "https://blog.dev"
app.site.canonical("/about/"); // "https://blog.dev/about/"
app.site.canonical("about/");  // "https://blog.dev/about/"
app.site.canonical("/");       // "https://blog.dev"
```

## API

Mounted at `app.site` and reachable from any plugin via `ctx.require(sitePlugin)`. Every accessor reads directly from frozen config; none mutate or emit, and all return primitives.

| Method | Signature | Notes |
|---|---|---|
| `name` | `() => string` | The configured human-readable site name. |
| `url` | `() => string` | The configured absolute base URL. |
| `author` | `() => string` | The configured author/byline. |
| `description` | `() => string` | The configured site description. |
| `canonical` | `(path: string) => string` | Joins `path` against the base `url` into one well-formed absolute canonical URL. |

### `canonical(path)` join semantics

- The trailing `/` is stripped from the base `url`.
- An empty path or `"/"` returns the trimmed base unchanged.
- A leading `/` is stripped from `path`, then joined as `base + "/" + path`.
- The supplied path's own trailing slash is **preserved**.
- The result is always a single well-formed absolute URL — never a double slash at the join boundary.

## Configuration

`pluginConfigs.site` — all four fields are **required at runtime**. The framework ships empty-string placeholders so the type stays a full `Config`, but there are no usable defaults: these are identity values only the consumer knows. `name` and `url` are validated at `onInit`.

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | `string` | `""` | Human-readable site name (feeds, `og:site_name`, titles). **Validated** non-empty. |
| `url` | `string` | `""` | Absolute base URL, e.g. `"https://blog.dev"`. **Validated** as an absolute http/https URL. |
| `author` | `string` | `""` | Default author/byline (feeds, article author meta). Free text. |
| `description` | `string` | `""` | Short site description (feeds, default meta description, `og:description` fallback). Free text. |

> [!IMPORTANT]
> `onInit` runs synchronously and **throws at `createApp`** if `name` is blank or `url` is not a valid absolute http/https URL:
> ```
> [web] site.name is required.
>   Provide a non-empty site name in pluginConfigs.site.name.
> ```
> ```
> [web] site.url must be a valid absolute URL (http/https), received "blog.dev".
>   Provide an absolute URL in pluginConfigs.site.url, e.g. "https://blog.dev".
> ```

## Lifecycle

- **`onInit`** — `validateSiteConfig`: validates the resolved config synchronously (fail-fast at `createApp`); throws on a blank `name` or a non-absolute/non-http `url`. Allocates no resource.
- **`onStart` / `onStop`** — not used. The plugin manages no server, connection, timer, or listener; all data is available synchronously from frozen config, so there is nothing to start or tear down.

## Dependencies

None. `site` declares no `depends` and calls no `ctx.require` — it is a leaf that everyone else consumes.

## Design notes

- **Frozen identity.** The four config fields are the whole data model. Accessors are thin closures over `ctx.config`; they return primitives, never internal references, so callers cannot mutate site identity.
- **Fail-fast, not silent defaults.** Empty-string placeholders exist only to satisfy the `Config` type. Real values must come from `pluginConfigs.site`, and `onInit` enforces that for the two structurally significant fields (`name`, `url`).
- **Errors use the `[web] site.<field> ...` format** — a one-line message plus an indented remediation hint, consistent across the framework.
- **Isomorphic.** No node or browser APIs beyond the standard `URL` parser; the same plugin runs unchanged on Node and in the browser, which is why it ships as a `createApp` default.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Wiring harness — `createPlugin("site", { config, onInit, api })`, typed default config, no logic. |
| `api.ts` | Logic: `validateSiteConfig` (`onInit`), `createSiteApi` (API factory), and the exported pure helpers `joinCanonical`, `isNonEmpty`, `isAbsoluteUrl`. |
| `types.ts` | Public `Config` and `Api` type definitions. |
| `__tests__/` | Colocated `unit/` and `integration/` suites. |

---

<sub>Part of <strong><a href="../../../README.md">@moku-labs/web</a></strong> — built on <a href="https://github.com/moku-labs/core">@moku-labs/core</a>.</sub>
