# site

> Micro plugin — global, frozen site metadata (name, url, author, description) plus canonical URL construction.

`site` is the single source of truth for the framework's global site identity.
Its four config fields **are** its data: validated once at `onInit` (fail-fast at
`createApp`) and immutable thereafter. The plugin owns no mutable state, declares
no events, and depends on nothing. It is consumed downstream by `router`, `head`,
and `build` (and indirectly by feeds/sitemap/SEO) via `ctx.require(sitePlugin)`,
which read `.name()`, `.url()`, and `.canonical(path)`.

## API

The API surface (`Api`) is mounted at `ctx.site` (and as `app.site`):

| Method | Returns | Description |
| ------ | ------- | ----------- |
| `name()` | `string` | The configured human-readable site name. |
| `url()` | `string` | The configured absolute base URL. |
| `author()` | `string` | The configured author/byline. |
| `description()` | `string` | The configured site description. |
| `canonical(path)` | `string` | Joins `path` against the base `url` into an absolute canonical URL. |

```ts
app.site.name();              // "My Blog"
app.site.url();               // "https://blog.dev"
app.site.canonical("/about/"); // "https://blog.dev/about/"
app.site.canonical("about/");  // "https://blog.dev/about/"
app.site.canonical("/");       // "https://blog.dev"
app.site.canonical("");        // "https://blog.dev"
```

### `canonical(path)` join semantics

- Trailing `/` is stripped from the base `url`.
- An empty path or `"/"` returns the trimmed base unchanged.
- A leading `/` is stripped from `path`, then joined as `base + "/" + path`.
- The supplied path's own trailing slash is **preserved**.
- The result is always a single well-formed absolute URL — never a double slash
  at the join boundary.

## Configuration

```ts
createApp({
  pluginConfigs: {
    site: {
      name: "My Blog",                                  // required, non-empty
      url: "https://blog.dev",                          // required, absolute http/https URL
      author: "Alex",                                   // required, free text
      description: "A personal blog about web frameworks." // required, free text
    }
  }
});
```

| Field | Type | Requirement |
| ----- | ---- | ----------- |
| `name` | `string` | Required, non-empty (validated). |
| `url` | `string` | Required, valid absolute http/https URL (validated). |
| `author` | `string` | Required, free text. |
| `description` | `string` | Required, free text. |

The framework ships empty-string placeholders so the type stays a full `Config`.
There are no usable defaults — these are site-identity values only the consumer
knows. `onInit` enforces the real requirement and **throws at `createApp`** if
`name` is blank or `url` is not a valid absolute URL:

```
[web] site.name is required.
  Provide a non-empty site name in pluginConfigs.site.name.
```

```
[web] site.url must be a valid absolute URL (http/https), received "blog.dev".
  Provide an absolute URL in pluginConfigs.site.url, e.g. "https://blog.dev".
```

## Lifecycle

- **onInit** — validates the resolved config (synchronous fail-fast); throws on a
  blank `name` or a non-absolute/non-http `url`. No resource is allocated.
- **onStart / onStop** — not used. The plugin manages no resource (no server,
  connection, timer, or listener); all data is available synchronously from
  frozen config the moment the app is constructed, so there is nothing to start
  or tear down.
