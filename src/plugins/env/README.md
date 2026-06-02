# env

> Standard core plugin — universal, multi-provider environment / secret injection resolved and frozen once at `onInit`.

`env` resolves configuration and secrets from a declared schema against an ordered
list of providers (`.env` files, `process.env`, Cloudflare per-request bindings),
validates the result, and **freezes** it. Resolution is fail-fast: a missing
required variable or a `PUBLIC_` naming violation throws at `createApp` time,
never at request time. The resolved accessor is mounted at `ctx.env` on every
plugin context (and as `app.env`).

## API

The API surface (`EnvApi`) is mounted at `ctx.env`:

| Method | Returns | Description |
| ------ | ------- | ----------- |
| `get(key)` | `string \| undefined` | Resolved value, or `undefined`. |
| `require(key)` | `string` | Resolved value, or **throws** if undefined. |
| `has(key)` | `boolean` | Whether a value is present. |
| `getPublic()` | `Readonly<Record<string, string>>` | Frozen plain-object copy of public vars. |
| `getPublicMap()` | `ReadonlyMap<string, string>` | The frozen public map — the sole sanctioned input to a build-time `define`. |

```ts
const url = ctx.env.get("PUBLIC_API_URL");   // string | undefined
const token = ctx.env.require("DEPLOY_TOKEN"); // string, or throws
const payload = { ...ctx.env.getPublic() };    // safe to send to the browser
```

### `EnvApi.require()` vs `ctx.require` — not the same thing

`EnvApi.require(key)` is the **environment-variable accessor**: it looks up a
resolved variable by string name and throws if it is undefined. It is unrelated
to the framework's `ctx.require(plugin)` — the **plugin-instance resolver** that
returns another plugin's API by instance reference. They share a name but have
entirely different inputs (a variable name vs a plugin instance) and outputs (a
string vs a plugin API). Do not confuse `ctx.env.require("X")` with
`ctx.require(xPlugin)`.

## Configuration

`pluginConfigs.env` accepts an `EnvConfig`:

| Field | Type | Spec default | Framework default | Notes |
| ----- | ---- | ------------ | ----------------- | ----- |
| `schema` | `Record<string, EnvVarSpec>` | `{}` | `{}` | Declares every variable the app reads. |
| `providers` | `EnvProvider[]` | `[]` | `[dotenv(), processEnv()]` (Node) / `[browserEnv()]` (browser) | Resolution order; index `0` wins on conflict. |
| `publicPrefix` | `string` | `"PUBLIC_"` | `"PUBLIC_"` | Bidirectionally enforced against `schema[key].public`. |

```ts
createApp({
  pluginConfigs: {
    env: {
      schema: {
        PUBLIC_API_URL: { public: true, default: "/api" },
        DEPLOY_TOKEN: { public: false, required: true, secret: true }
      },
      providers: [dotenv(".env.local"), processEnv()]
    }
  }
});
```

With the framework default order, a value in `.env.local` **wins over**
`process.env`. For the opposite precedence (e.g. CI overrides) pass
`[processEnv(), dotenv()]`; Cloudflare deployments typically use
`[cloudflareBindings(), processEnv()]`.

### Default provider per entry point

The default `providers` differ by which package entry you import:

- **`.` (Node)** — wires `[dotenv(), processEnv()]`. Node-only providers
  (`dotenv`, `processEnv`, `cloudflareBindings`) are exported here and must be
  composed explicitly for non-default precedence.
- **`./browser`** — the `@moku-labs/web/browser` entry **pre-wires
  `browserEnv()`** as the default env provider, so `env` works with **zero
  consumer config** in the browser. You do **not** need to pass
  `pluginConfigs.env.providers`; it resolves from `import.meta.env` and
  `globalThis.__ENV__`. The node-only providers are not exported from this
  entry.

## Providers

- **`dotenv(path = ".env.local")`** — zero-dependency `.env` parser, re-read from
  disk on every `load()`. Missing file resolves to `{}`. Handles CRLF/LF, blank
  lines and full-line `#` comments, first-`=` splitting, key/value trimming, and a
  single outer quote pair. Trailing inline comments on **unquoted** values are
  **not** stripped (`KEY=value # x` resolves to `value # x`). `KEY=` yields an
  empty string, which is later coerced to `undefined` during the merge.
- **`processEnv()`** — returns a shallow copy of `process.env` at `load()` time.
- **`browserEnv()`** — browser-safe provider that resolves from `import.meta.env`
  and `globalThis.__ENV__`. It is **pre-wired as the default provider** by the
  `@moku-labs/web/browser` entry, so a browser app needs no manual
  `env.providers` wiring.
- **`cloudflareBindings()`** — reads `globalThis.__CLOUDFLARE_ENV__` fresh on every
  `load()` and **never caches**. The consumer (request handler) owns the global's
  lifecycle: set it at the start of a request and clear it at the end. Apps that
  need per-request Cloudflare freshness re-resolve via this provider at the request
  boundary rather than relying on the frozen `ctx.env` snapshot.

## Resolution pipeline (at `onInit`)

1. Merge providers in array order; coerce `""` → `undefined` **before** precedence
   (first non-empty value wins).
2. Bidirectional `PUBLIC_` cross-check — a `public: true` key must start with
   `publicPrefix`, and a `publicPrefix`-named key must be `public: true`; either
   violation throws.
3. Apply `schema[key].default` for still-undefined keys.
4. Assert `required: true` keys are defined (throws naming the variable).
5. Populate `resolved` (every defined schema key) and `publicMap` (the
   `public: true` subset).
6. Freeze both maps via `freezeMap` — `set` / `clear` / `delete` become
   non-configurable throwers, then `Object.freeze`.

## Immutability

`Object.freeze` alone does not block `Map` mutators, so `freezeMap` redefines
`set`, `clear`, and `delete` as non-writable, non-configurable functions that
throw `TypeError("env: map is frozen and cannot be mutated")` before freezing the
map. Both `resolved` and `publicMap` are genuinely read-only and per-app isolated.
