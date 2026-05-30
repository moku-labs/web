# deploy

> Standard plugin — deploys the built `dist/` to Cloudflare Pages via the `wrangler`
> subprocess, with entropy-gated secret scrubbing, preflight + path-traversal guards,
> and an `init` flow that scaffolds `wrangler.jsonc` and an optional GitHub Actions
> workflow.

## API

<!-- Populated during build -->

## Configuration

<!-- Populated during build -->

## Notes

The distinction between `EnvApi.require` (read a required environment variable, e.g.
`CLOUDFLARE_API_TOKEN`) and `ctx.require` (resolve a required plugin instance, e.g.
`sitePlugin`) is documented in the **env** plugin README — not here.
