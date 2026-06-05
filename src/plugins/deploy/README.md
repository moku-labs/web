# deploy

> Standard plugin — deploys the built `dist/` to Cloudflare Pages via the `wrangler`
> subprocess, with entropy-gated secret scrubbing, preflight + path-traversal guards,
> and an `init` flow that scaffolds `wrangler.jsonc` and an optional GitHub Actions
> workflow.

`deploy` is **API-driven**: nothing happens at framework start — work occurs only when
the consumer explicitly calls `app.deploy.run()` (or `app.deploy.init()`). It depends on
`site` (via `ctx.require(sitePlugin)`) to derive the Cloudflare project-name slug from
`site.name()`, so there is no hand-maintained `projectName` config field. There is no
`onStart`/`onStop` — `deploy` owns no long-lived resource; the wrangler subprocess is
spawned per `run()` call and fully awaited before `run()` resolves. `onInit` performs
synchronous config validation only and resolves the `site` dependency.

`index.ts` is a wiring harness only. All logic lives in sibling modules: `wrangler.ts`
(spawn, scrub, guards, error taxonomy, output parsing), `preflight.ts` (cheap → expensive
validators), `slug.ts`, `init.ts` (scaffolding + drift), and `generators/` (pure string
generators for `wrangler.jsonc` and the GitHub Actions workflow).

## API

The API surface (`Api`) is mounted at `ctx.deploy` (and as `app.deploy`).

### `run(options?): Promise<DeployResult>`

Deploys the built `outDir` to Cloudflare Pages via the `wrangler` subprocess. In order, it:
derives the slug from `site.name()`; resolves the branch (`options.branch ??
config.productionBranch ?? "main"`); runs the preflight validators; builds the wrangler
argv array — guarding the branch against flag injection and re-validating the resolved
`outDir` against the project root; reads `CLOUDFLARE_API_TOKEN` via `ctx.env.require` (passed
to the subprocess `env` only, **never** logged); spawns wrangler via the injectable spawner;
scrubs all subprocess output before logging; records `lastDeployment`; and emits
`deploy:complete` — but **only** on a zero-exit success. A non-zero exit is mapped through the
wrangler error taxonomy and thrown as an `Error` carrying a `code`.

`options.branch` defaults to `config.productionBranch` (or `"main"`) and must match
`/^[a-zA-Z0-9/_.-]+$/`. `deploy` does not run a build — it ships whatever already exists in
`outDir` — so build the site first (e.g. via `app.cli.build()`). On success it returns
`{ url, deploymentId, branch, durationMs }`.

```ts
// Production deploy.
const result = await app.deploy.run();
console.log(result.url); // "https://my-site.pages.dev"

// Preview deploy on a feature branch.
await app.deploy.run({ branch: "preview/landing" });
```

> `CLOUDFLARE_API_TOKEN` is read via `ctx.env.require("CLOUDFLARE_API_TOKEN")` and passed only
> to the subprocess `env` — it is never placed in argv, never logged, and never added to the
> scrub allowlist. If it is unset, `ctx.env.require` throws (`ERR_DEPLOY_NO_TOKEN`).

### `getLastDeployment(): Readonly<DeployResult> | null`

Returns a frozen, defensive snapshot of the most recent successful deploy, or `null` if no
deploy has succeeded yet.

```ts
const last = app.deploy.getLastDeployment();
if (last) console.log(`Last deployed to ${last.url}`);
```

### `init(options?): Promise<InitResult>`

Generates deploy scaffolding: `wrangler.jsonc` (slug from `site.name()`, plus `outDir` and
`compatibilityDate` from config) and, when `ci` is enabled, a SHA-pinned
`.github/workflows/deploy.yml`. It **never** overwrites an existing `wrangler.jsonc`. In
check mode (`options.check`) it writes nothing and instead reports which files would drift
from their on-disk content. `options.ci` defaults to `config.ci`; `options.check` defaults to
`false`. Returns `{ written, skipped, drifted }`.

```ts
// Scaffold both files in a fresh project.
const out = await app.deploy.init({ ci: true });
// out.written -> ["wrangler.jsonc", ".github/workflows/deploy.yml"]

// Drift check in CI — writes nothing, reports differences.
const drift = await app.deploy.init({ check: true });
if (drift.drifted.length) process.exit(1);
```

## Configuration

| Field               | Type                  | Default                      | Description                                                                                  |
| ------------------- | --------------------- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| `target`            | `"cloudflare-pages"`  | `"cloudflare-pages"`         | Deploy target. Only Cloudflare Pages is supported in this version.                           |
| `outDir`            | `string`              | `"dist"`                     | Directory (relative to project root) with the built site. Re-validated against cwd at `run()` time to block path traversal. |
| `productionBranch`  | `string \| undefined` | `"main"`                     | Branch treated as the Cloudflare Pages production branch when `run()` is called without an explicit `branch`. |
| `scrubAllowlist`    | `string[]`            | `["CLOUDFLARE_ACCOUNT_ID"]`  | Substrings exempt from entropy-gated secret scrubbing in logged output.                       |
| `compatibilityDate` | `string \| undefined` | `"2024-01-01"`               | Cloudflare compatibility date written into generated `wrangler.jsonc` (`YYYY-MM-DD`).         |
| `ci`                | `boolean \| undefined`| `false`                      | Whether `init()` also generates the GitHub Actions workflow.                                  |

`onInit` validates the resolved config (synchronous fail-fast) and throws `ERR_DEPLOY_CONFIG`
when `target` is unsupported, `outDir` is not a non-empty string, `scrubAllowlist` is not an
array of strings, or `compatibilityDate` (if present) is not `YYYY-MM-DD`. It also resolves the
`site` dependency so a missing slug source is caught at `createApp`.

The free-tier file-count cap (20000) used by preflight can be raised toward the paid-tier cap
(100000) via the `MOKU_DEPLOY_MAX_FILES` environment variable — it is not a config field.

## Events

- **`deploy:complete`** `{ url, deploymentId, branch, durationMs }` — emitted **once** after a
  successful (`exit 0`) deploy, with the same fields as the returned `DeployResult`.

`deploy` emits this event only; it is notification-only (nothing depends on it for
orchestration) and the plugin listens to nothing. A failed deploy emits nothing.

## Security

Hardening is concentrated in `wrangler.ts` and applied on every `run()`:

- **Entropy-gated secret scrubbing.** `scrubSecrets` tokenizes stdout/stderr and masks any token
  that is **both** ≥ 16 characters **and** ≥ 3.5 bits/char Shannon entropy with `***`, unless it
  contains an allowlisted substring (default `CLOUDFLARE_ACCOUNT_ID`). Scrubbing happens **before**
  anything reaches `ctx.log`: by convention only `scrubbed*`-named values may be passed to a log
  call, so raw stderr can never leak (fixing the legacy `ctx.log.info(stderr)` leak). The error
  taxonomy classifies against the already-scrubbed stderr too.
- **Token via env only.** `CLOUDFLARE_API_TOKEN` is read with `ctx.env.require` and injected into
  the subprocess `env` exclusively — never into argv, never logged, never allowlisted.
- **Argv arrays / no shell.** wrangler is spawned with an argv array
  (`["bunx","wrangler","pages","deploy", outDir, "--project-name", slug, "--branch", branch]`)
  through the injectable `spawn` (default `Bun.spawn`) — never a string interpolated into a shell,
  so shell metacharacters cannot be interpreted.
- **Branch flag-injection guard.** `guardBranch` rejects any branch not matching
  `/^[a-zA-Z0-9/_.-]+$/` (and any leading `-`) with `ERR_DEPLOY_INVALID_BRANCH`, so a branch value
  can never be parsed by wrangler as a flag (e.g. `--config`).
- **Path-traversal guard.** `assertWithinRoot` resolves `outDir` to an absolute path and asserts it
  stays inside the project root, rejecting an escape with `ERR_DEPLOY_PATH_TRAVERSAL`.
- **`run()`-time `outDir` re-validation.** The path-traversal check (and the preflight validators)
  run on **every** `run()` — not only at `onInit` — defending against a config or `wrangler.jsonc`
  that points outside the project root after construction.
- **SHA-pinned CI.** The generated workflow pins every action (`actions/checkout`,
  `oven-sh/setup-bun`, `cloudflare/wrangler-action`) to a commit SHA (with a `# vX` comment) rather
  than a floating tag, sources the wrangler version from the single `MOKU_WRANGLER_VERSION`
  constant, and injects secrets via `${{ secrets.* }}` — never inlined.

## Notes

The distinction between `EnvApi.require` (read a required environment variable, e.g.
`CLOUDFLARE_API_TOKEN`) and `ctx.require` (resolve a required plugin instance, e.g.
`sitePlugin`) is documented in the **env** plugin README — not here.
