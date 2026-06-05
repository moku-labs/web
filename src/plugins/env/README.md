# env

> **Core** — multi-provider environment / secret injection, validated and frozen once at `onInit`.

`env` resolves configuration and secrets from a declared `schema` against an ordered list of
providers (`.env` files, `process.env`, Cloudflare per-request bindings, `import.meta.env`),
applies defaults, asserts the required ones, cross-checks the `PUBLIC_` naming convention, then
**freezes** the result. Resolution is fail-fast: a missing required variable or a `PUBLIC_`
violation throws at `createApp` time, never at request time. The resolved accessor is mounted
at `ctx.env` on every plugin context (and at `app.env`).

It is a pure-compute core plugin: it runs `onInit` only and holds no `onStart`/`onStop` — it
owns no socket, file handle, or process resource, just the two frozen maps it builds once. The
defining design decision is that the resolved table is **genuinely immutable** (see
[Design notes](#design-notes)): both maps are sealed so `set`/`clear`/`delete` throw, making
`ctx.env` a read-only snapshot for the life of the app.

## Example
```ts
import { createApp, dotenv, processEnv } from "@moku-labs/web";

const app = createApp({
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

const url = app.env.get("PUBLIC_API_URL");     // string | undefined
const token = app.env.require("DEPLOY_TOKEN");  // string, or throws
const payload = { ...app.env.getPublic() };     // safe to ship to the browser
```

> [!NOTE]
> `EnvApi.require(key)` is the **environment-variable accessor** — it looks up a resolved
> variable by string name and throws if undefined. It is unrelated to the framework's
> `ctx.require(plugin)`, the **plugin-instance resolver** that returns another plugin's API by
> instance reference. Same name, different inputs (variable name vs plugin instance) and
> outputs (string vs plugin API). Do not confuse `ctx.env.require("X")` with `ctx.require(xPlugin)`.

## API
The `EnvApi` surface is mounted at `ctx.env` (and `app.env`). All accessors read from the
frozen `resolved` / `publicMap` maps; mutation is impossible.

| Method | Signature | Notes |
|---|---|---|
| `get` | `(key: string) => string \| undefined` | Resolved value, or `undefined` if absent. |
| `require` | `(key: string) => string` | Resolved value, or **throws** `[web] env: required variable "<key>" is not defined.` if undefined. |
| `has` | `(key: string) => boolean` | Whether a value is present. |
| `getPublic` | `() => Readonly<Record<string, string>>` | Fresh frozen plain-object copy of the public vars — convenient for spreading into a serializable payload. |
| `getPublicMap` | `() => ReadonlyMap<string, string>` | The already-frozen public map — the **sole** sanctioned input to a build-time `define` injection. |

## Configuration
`pluginConfigs.env` accepts an `EnvConfig`. All fields are optional — every one has a spec
default, so `env` composes with no config (resolving an empty environment).

| Field | Type | Default | Notes |
|---|---|---|---|
| `schema` | `Record<string, EnvVarSpec>` | `{}` | Per-variable validation + exposure rules, keyed by variable name. |
| `providers` | `EnvProvider[]` | `[]` | Ordered value sources; first non-`undefined`/non-empty value per key wins. The spec default is `[]` — the consumer wires providers per target (see below). |
| `publicPrefix` | `string` | `"PUBLIC_"` | Prefix that public variable names must carry; bidirectionally enforced at `onInit`. |

Each `schema` entry is an `EnvVarSpec`:

| Field | Type | Default | Notes |
|---|---|---|---|
| `public` | `boolean` | — (required) | If `true`, the key **must** start with `publicPrefix` and is included in `getPublicMap`. |
| `required` | `boolean` | `false` | If `true`, resolution throws when the value is undefined after defaults. |
| `default` | `string` | — | Value applied when no provider supplies the variable. |
| `secret` | `boolean` | `false` | Documentation / tooling marker only — no runtime effect, but a secret may never be `public`. |

> [!TIP]
> The `providers` spec default is `[]`; the consumer supplies them per target. A common Node
> wiring is `[dotenv(), processEnv()]` — with that order a value in `.env.local` **wins over**
> `process.env`. For the opposite precedence (e.g. CI overrides) pass `[processEnv(), dotenv()]`;
> Cloudflare deployments typically use `[cloudflareBindings(), processEnv()]`. The
> `@moku-labs/web/browser` entry **pre-wires `browserEnv()`**, so the browser needs zero
> provider config.

## Dependencies
None. `env` declares no `depends` and pulls no sibling plugin via `ctx.require`. It is a leaf
core plugin that everything else may read from.

## Providers
Provider factories are exported from the package, not from `envPlugin` itself. The Node-only
providers (`dotenv`, `processEnv`, `cloudflareBindings`) import `node:fs` and are re-exported
from the package root (`@moku-labs/web`); `browserEnv` is `node:*`-free and ships on both the
root barrel and `@moku-labs/web/browser`.

| Provider | Name | Source | Behavior |
|---|---|---|---|
| `dotenv(path = ".env.local")` | `dotenv:<path>` | A `.env`-style file | Zero-dependency parser, re-read from disk every `load()`. Missing file → `{}`. Handles CRLF/LF, blank lines, full-line `#` comments, first-`=` splitting, key/value trimming, and a single outer quote pair. Trailing inline comments on **unquoted** values are **not** stripped (`KEY=value # x` → `value # x`). `KEY=` yields `""`, later coerced to `undefined` during merge. |
| `processEnv()` | `process-env` | `process.env` | Returns a shallow copy of `process.env` at `load()` time. |
| `cloudflareBindings()` | `cloudflare` | `globalThis.__CLOUDFLARE_ENV__` | Reads the global fresh every `load()` and **never caches**. The request handler owns the global's lifecycle. |
| `browserEnv(options?)` | `browser-env` | `import.meta.env` + `globalThis[globalKey]` | Browser-safe (zero `node:*`). Merges both sources, runtime global winning; each absent source → `{}`; never throws. `options.globalKey` defaults to `"__ENV__"`. Pre-wired as the default provider by `@moku-labs/web/browser`. |

You may also supply a custom `EnvProvider` — any object with a `name` and a
`load(): Record<string, string | undefined>` method.

## Events
None. `env` subscribes to no `hooks` and emits no events; it is purely a synchronous `onInit`
resolution step with a read accessor.

## Design notes

**Resolution pipeline (at `onInit`, `validateSchema`).** Fail-fast, in this exact order:

1. Merge providers in array order; coerce `""` → `undefined` **before** precedence (first
   non-empty value wins).
2. Bidirectional `PUBLIC_` cross-check — a `public: true` key must start with `publicPrefix`,
   and a `publicPrefix`-named key must be `public: true`; either violation throws.
3. Apply `schema[key].default` for still-undefined keys.
4. Assert `required: true` keys are defined (throws naming the variable).
5. Populate `publicMap` (the `public: true` subset of schema keys with a value) and `resolved`
   (**every** merged key with a defined value, including non-schema provider keys — so
   `ctx.env.require()` works for dynamic keys outside the schema).
6. Freeze both maps via `freezeMap`.

**Genuine immutability.** `Object.freeze` alone does not block `Map` mutators, so `freezeMap`
redefines `set`, `clear`, and `delete` as non-writable, non-configurable functions that throw
`TypeError("env: map is frozen and cannot be mutated")`, then `Object.freeze`s the map for
defense in depth. Both `resolved` and `publicMap` are genuinely read-only and per-app isolated.

**`publicMap` is schema-scoped on purpose.** `resolved` includes non-schema provider keys for
dynamic lookups, but `publicMap` is strictly the `public: true` schema subset — it is the only
sanctioned input to a browser-facing `define`, so it must never leak an unvetted provider key.

**Per-target export split.** The Node providers are deliberately not re-exported from
`envPlugin` (they import `node:fs`, and `envPlugin` is pulled into every composition, browser
ones included). They live on the package root where `"sideEffects": false` lets a browser
bundle tree-shake them; `browserEnv` stays on the barrel because it is `node:*`-free.

## Files
| File | Responsibility |
|---|---|
| `index.ts` | `envPlugin` wiring (`config` + `createState` + `api` + `onInit`); re-exports `browserEnv` and public types. |
| `types.ts` | Public + boundary types: `EnvApi`, `EnvConfig`, `EnvProvider`, `EnvState`, `EnvVarSpec`. |
| `api.ts` | `createEnvApi` — builds the `get`/`require`/`has`/`getPublic`/`getPublicMap` accessor over frozen state. |
| `state.ts` | `createEnvState` — fresh empty `resolved` + `publicMap` maps. |
| `validate.ts` | `validateSchema` (the `onInit` pipeline) + the exported `freezeMap` immutability helper. |
| `providers.ts` | Node providers: `dotenv`, `processEnv`, `cloudflareBindings` (import `node:fs`). |
| `providers.browser.ts` | `browserEnv` — browser-safe provider (zero `node:*`). |
| `__tests__/` | Unit + integration tests. |

---

<sub>Part of <strong><a href="../../../README.md">@moku-labs/web</a></strong> — built on <a href="https://github.com/moku-labs/core">@moku-labs/core</a>.</sub>
