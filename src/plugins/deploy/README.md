# deploy

> **Node-only** — ships the built `outDir` to Cloudflare Pages via the injectable `wrangler` subprocess, and scaffolds `wrangler.jsonc` (plus an optional GitHub Actions workflow), with entropy-gated secret scrubbing and preflight + path-traversal guards.

`deploy` is **API-driven**: nothing happens at framework start — work occurs only when a consumer explicitly calls `app.deploy.run()` (or `app.deploy.init()`). It depends on `site` and pulls it via `ctx.require(sitePlugin)` to derive the Cloudflare project-name slug from `site.name()`, so there is no hand-maintained `projectName` config field. The surface mounts at **`app.deploy`** and emits a single notification-only event, **`deploy:complete`**.

Lifecycle: `onInit` only — synchronous config validation plus resolving the `site` dependency. There is **no `onStart`/`onStop`**; `deploy` owns no long-lived resource, and the wrangler subprocess is spawned per `run()` and fully awaited before `run()` resolves. The single most important design decision is that the subprocess spawner is **injectable state** (`state.spawn`, defaulting to a lazy `Bun.spawn`), so wrangler is never actually invoked in tests. `index.ts` is a wiring harness only — all logic lives in sibling modules.

## Example
```ts
import { createApp } from "@moku-labs/web";
import { sitePlugin, deployPlugin } from "@moku-labs/web";

const app = createApp({
  plugins: [sitePlugin, deployPlugin],
  pluginConfigs: {
    site: { name: "My Cool Site", url: "https://example.com" },
    deploy: { outDir: "dist", productionBranch: "main" }
  }
});

// One-time: scaffold wrangler.jsonc (+ optional CI workflow).
await app.deploy.init({ ci: true });

// Build first (deploy ships whatever is already in outDir), then deploy.
const result = await app.deploy.run();
console.log(result.url); // "https://my-cool-site.pages.dev"
```

> [!NOTE]
> `deploy` does **not** run a build — it ships whatever already exists in `outDir`. Build the site first (e.g. via `app.cli.build()`).

## API

The surface (`Api`) is mounted at `app.deploy` (and as `ctx.deploy`).

### `run(options?: DeployRunOptions): Promise<DeployResult>`

Deploys the built `outDir` to Cloudflare Pages via the `wrangler` subprocess. In order, it: derives the slug from `site.name()`; resolves the branch (`options.branch ?? config.productionBranch ?? "main"`); runs the preflight validators; builds the wrangler argv array — guarding the branch against flag injection and re-validating the resolved `outDir` against the project root; reads `CLOUDFLARE_API_TOKEN` via `ctx.env.require` (passed to the subprocess `env` only, **never** logged); spawns wrangler via the injectable spawner; scrubs all subprocess output before logging; records `lastDeployment`; and emits `deploy:complete` — but **only** on a zero-exit success. A non-zero exit is mapped through the wrangler error taxonomy and thrown as an `Error` carrying a `code`.

`options.branch` defaults to `config.productionBranch` (or `"main"`) and must match `/^[a-zA-Z0-9/_.-]+$/`. On success it returns `{ url, deploymentId, branch, durationMs }`.

```ts
// Production deploy.
const result = await app.deploy.run();
console.log(result.url); // "https://my-site.pages.dev"

// Preview deploy on a feature branch.
await app.deploy.run({ branch: "preview/landing" });
```

> [!IMPORTANT]
> `CLOUDFLARE_API_TOKEN` is read via `ctx.env.require("CLOUDFLARE_API_TOKEN")` and passed only to the subprocess `env` — never placed in argv, never logged, never added to the scrub allowlist. If it is unset, `ctx.env.require` throws (the `env` plugin's "required variable … is not defined" error).

### `getLastDeployment(): Readonly<DeployResult> | null`

Returns a frozen, defensive snapshot of the most recent successful deploy, or `null` if no deploy has succeeded yet.

```ts
const last = app.deploy.getLastDeployment();
if (last) console.log(`Last deployed to ${last.url}`);
```

### `init(options?: DeployInitOptions): Promise<InitResult>`

Generates deploy scaffolding: `wrangler.jsonc` (slug from `site.name()`, plus `outDir` and `compatibilityDate` from config) and, when `ci` is enabled, a SHA-pinned `.github/workflows/deploy.yml`. It **never** overwrites an existing `wrangler.jsonc` (idempotent — re-running is a no-op). In check mode (`options.check`) it writes nothing and instead reports which files would drift from their on-disk content. `options.ci` defaults to `config.ci`; `options.check` defaults to `false`. Returns `{ written, skipped, drifted }`.

```ts
// Scaffold both files in a fresh project.
const out = await app.deploy.init({ ci: true });
// out.written -> ["wrangler.jsonc", ".github/workflows/deploy.yml"]

// Drift check in CI — writes nothing, reports differences.
const drift = await app.deploy.init({ check: true });
if (drift.drifted.length) process.exit(1);
```

## Configuration

`pluginConfigs.deploy` — all fields optional (every field has a default; override individually).

| Field | Type | Default | Notes |
|---|---|---|---|
| `target` | `"cloudflare-pages"` | `"cloudflare-pages"` | Deploy target. Only Cloudflare Pages is supported in this version. |
| `outDir` | `string` | `"dist"` | Directory (relative to project root) with the built site. Re-validated against cwd at `run()` time to block path traversal. |
| `productionBranch` | `string` | `"main"` | Branch treated as the Cloudflare Pages production branch when `run()` is called without an explicit `branch`. |
| `scrubAllowlist` | `string[]` | `["CLOUDFLARE_ACCOUNT_ID"]` | Substrings exempt from entropy-gated secret scrubbing in logged output. |
| `compatibilityDate` | `string` | `"2024-01-01"` | Cloudflare compatibility date written into generated `wrangler.jsonc` (`YYYY-MM-DD`). |
| `ci` | `boolean` | `false` | Whether `init()` also generates the GitHub Actions workflow. |

`onInit` validates the resolved config (synchronous fail-fast) and throws `ERR_DEPLOY_CONFIG` when `target` is unsupported, `outDir` is not a non-empty string, `scrubAllowlist` is not an array of strings, or `compatibilityDate` (if present) is not `YYYY-MM-DD`. It also resolves the `site` dependency so a missing slug source is caught at `createApp`.

> [!TIP]
> The free-tier file-count cap (`20000`) enforced by preflight can be raised toward the paid-tier cap (`100000`) via the `MOKU_DEPLOY_MAX_FILES` environment variable — it is **not** a config field.

## Dependencies

`depends: [sitePlugin]`. At run time `deploy` PULLs the `site` API via `ctx.require(sitePlugin)` and calls `site.name()`, then runs it through `toSlug` to produce the Cloudflare project-name slug — for both `run()` (the `--project-name` argument) and `init()` (the generated `wrangler.jsonc` `name`). It also consumes the core `env` (`ctx.env.require` for `CLOUDFLARE_API_TOKEN`) and `log` (`ctx.log.info`, scrubbed output only) slices.

## Events

| Event | Payload | When |
|---|---|---|
| `deploy:complete` | `{ url, deploymentId, branch, durationMs }` | Emitted **once** after a successful (`exit 0`) deploy, with the same fields as the returned `DeployResult`. |

Emit-only and notification-only — nothing depends on it for orchestration, and the plugin listens to nothing (no hooks). A failed deploy emits nothing.

## Output

`init()` writes (and `init({ check: true })` checks for drift against) these files at the project root:

| Path | Generator | Notes |
|---|---|---|
| `wrangler.jsonc` | `generateWranglerConfig` | `$schema`, `name` (slug), `pages_build_output_dir` (outDir), `compatibility_date`. Idempotent — never overwritten. |
| `.github/workflows/deploy.yml` | `generateGithubWorkflow` | Only when `ci` is enabled. SHA-pinned actions; wrangler version from the single `MOKU_WRANGLER_VERSION` constant. |

## Design notes

Hardening is concentrated in `wrangler.ts` and applied on every `run()`:

- **Entropy-gated secret scrubbing.** `scrubSecrets` tokenizes stdout/stderr and masks any token that is **both** ≥ 16 characters **and** ≥ 3.5 bits/char Shannon entropy with `***`, unless it contains an allowlisted substring (default `CLOUDFLARE_ACCOUNT_ID`). Scrubbing happens **before** anything reaches `ctx.log`: by convention only `scrubbed*`-named values may be passed to a log call, so raw stderr can never leak. The error taxonomy classifies against the already-scrubbed stderr too.
- **Token via env only.** `CLOUDFLARE_API_TOKEN` is read with `ctx.env.require` and injected into the subprocess `env` exclusively — never into argv, never logged, never allowlisted.
- **Argv arrays / no shell.** wrangler is spawned with an argv array (`["bunx","wrangler","pages","deploy", outDir, "--project-name", slug, "--branch", branch]`) through the injectable `spawn` (default `Bun.spawn`) — never a string interpolated into a shell, so shell metacharacters cannot be interpreted.
- **Branch flag-injection guard.** `guardBranch` rejects any branch not matching `/^[a-zA-Z0-9/_.-]+$/` (and any leading `-`) with `ERR_DEPLOY_INVALID_BRANCH`, so a branch value can never be parsed by wrangler as a flag (e.g. `--config`).
- **Path-traversal guard.** `assertWithinRoot` resolves `outDir` to an absolute path and asserts it stays inside the project root, rejecting an escape with `ERR_DEPLOY_PATH_TRAVERSAL`.
- **`run()`-time re-validation.** The path-traversal check and the preflight validators run on **every** `run()` — not only at `onInit` — defending against a config or `wrangler.jsonc` that points outside the project root after construction.
- **SHA-pinned CI.** The generated workflow pins every action (`actions/checkout`, `oven-sh/setup-bun`, `cloudflare/wrangler-action`) to a commit SHA (with a `# vX` comment) rather than a floating tag, sources the wrangler version from the single `MOKU_WRANGLER_VERSION` constant, and injects secrets via `${{ secrets.* }}` — never inlined.

Preflight runs cheap → expensive, short-circuiting on the first failure: (1) `wrangler.jsonc` exists; (2) `outDir` exists and is non-empty; (3) file count ≤ the (env-overridable) tier limit; (4) no single file > 25 MiB.

The full error taxonomy (`DeployErrorCode`) spans `ERR_DEPLOY_NO_WRANGLER_CONFIG`, `ERR_DEPLOY_EMPTY_OUTDIR`, `ERR_DEPLOY_TOO_MANY_FILES`, `ERR_DEPLOY_FILE_TOO_LARGE`, `ERR_DEPLOY_PATH_TRAVERSAL`, `ERR_DEPLOY_INVALID_BRANCH`, `ERR_DEPLOY_PROJECT_NOT_FOUND`, `ERR_DEPLOY_AUTH_EXPIRED`, `ERR_DEPLOY_AUTH`, `ERR_DEPLOY_NETWORK`, `ERR_DEPLOY_WRANGLER_FAILED`, and `ERR_DEPLOY_CONFIG`. Each thrown `Error` carries the matching `code`.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Wiring harness — `createPlugin("deploy", { config, depends, createState, events, onInit, api })`. No logic. |
| `api.ts` | `createApi` (the `run`/`getLastDeployment`/`init` factory), `validateConfig` (`onInit`), and the deploy plugin context type. |
| `types.ts` | Public types: `Config`, `Api`, `DeployResult`, `State`, `DeployRunOptions`, `DeployInitOptions`, `InitResult`, the `SpawnFunction`/`SpawnOptions`/`SpawnedProcess` shapes, and the `DeployErrorCode`/`WranglerErrorKind` taxonomy. |
| `defaults.ts` | `defaultConfig` — the typed default config constant. |
| `events.ts` | `deployEvents` — typed `deploy:complete` declaration. |
| `state.ts` | `createState` — `lastDeployment: null` + the lazy `Bun.spawn` default spawner. |
| `slug.ts` | `toSlug` — site name → Cloudflare project-name slug (NFKD, ≤ 58 chars, linear scan). |
| `preflight.ts` | `runPreflight`, `inspectOutdir`, `resolveFileLimit` — the cheap → expensive validators. |
| `wrangler.ts` | `runWrangler`, `buildWranglerArgs`, `scrubSecrets`, `guardBranch`, `assertWithinRoot`, `classifyWranglerError`, `parseDeployUrl`, `parseDeploymentId`, `deployError`, `MOKU_WRANGLER_VERSION`. |
| `init.ts` | `writeScaffolding` — scaffold orchestration with idempotent write + drift-check modes. |
| `generators/wrangler-config.ts` | `generateWranglerConfig` + `readWranglerConfig` (pure). |
| `generators/github-workflow.ts` | `generateGithubWorkflow` — SHA-pinned workflow YAML (pure). |
| `__tests__/` | Colocated `unit/` and `integration/` suites. |

> [!NOTE]
> The distinction between `EnvApi.require` (read a required environment variable, e.g. `CLOUDFLARE_API_TOKEN`) and `ctx.require` (resolve a required plugin instance, e.g. `sitePlugin`) is documented in the [**env**](../env/README.md) plugin README.

---

<sub>Part of <strong><a href="../../../README.md">@moku-labs/web</a></strong> — built on <a href="https://github.com/moku-labs/core">@moku-labs/core</a>.</sub>
