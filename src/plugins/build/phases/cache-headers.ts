/**
 * @file build phase — cache-headers. Emits `outDir/_headers` (Cloudflare Pages
 * header rules) so the CDN/browser cache can never serve a stale file: every
 * fingerprinted bundle gets a per-file immutable rule (its URL changes with its
 * content, so caching it forever is safe), and every OTHER URL — pages, content
 * images, feeds, data sidecars: stable URLs whose bytes may change between
 * deploys — gets a catch-all revalidation rule (an unchanged file still answers
 * `304 Not Modified` via its ETag, so it is effectively cached; a changed file is
 * picked up immediately). The app's own `<publicDir>/_headers` rules are appended
 * AFTER the generated ones so the app can override them. Gated by
 * `config.cacheHeaders` (`false` disables; default on).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PhaseContext } from "../types";
import { readBundleOutputs } from "./asset-tags";
import { DEFAULT_PUBLIC_DIR } from "./public";

/**
 * `Cache-Control` for fingerprinted bundles: their URL embeds a content hash, so
 * the bytes behind a given URL can never change — cache them for a year, immutably.
 */
const DEFAULT_ASSETS_CACHE = "public, max-age=31536000, immutable";

/**
 * `Cache-Control` for everything else (stable URLs): always revalidate with the
 * origin. Unchanged files still serve from cache via a `304` ETag round-trip;
 * changed files are fetched fresh — never stale, still cheap.
 */
const DEFAULT_PAGES_CACHE = "public, max-age=0, must-revalidate";

/**
 * Cloudflare Pages caps `_headers` at 100 rules and silently ignores the rest —
 * a site whose bundle count pushes past the cap needs a warning, not silence.
 */
const CLOUDFLARE_RULE_LIMIT = 100;

/**
 * Result of the cache-headers phase — the written `_headers` path + rule count.
 *
 * @example
 * ```ts
 * const result: CacheHeadersResult = { path: "dist/_headers", ruleCount: 4 };
 * ```
 */
export type CacheHeadersResult = {
  /** The on-disk path of the written `_headers` file. */
  path: string;
  /** The number of generated header rules (catch-all + per-file). */
  ruleCount: number;
};

/**
 * Resolve the two `Cache-Control` values from `config.cacheHeaders` (`true` or an
 * object — `false` never reaches here; the pipeline gates the phase off).
 *
 * @param cacheHeaders - The `config.cacheHeaders` value.
 * @returns The `assets` (fingerprinted bundles) + `pages` (everything else) values.
 * @example
 * ```ts
 * resolvePolicy(true); // { assets: DEFAULT_ASSETS_CACHE, pages: DEFAULT_PAGES_CACHE }
 * ```
 */
function resolvePolicy(cacheHeaders: undefined | boolean | { assets?: string; pages?: string }): {
  assets: string;
  pages: string;
} {
  const policy = typeof cacheHeaders === "object" ? cacheHeaders : {};
  return {
    assets: policy.assets ?? DEFAULT_ASSETS_CACHE,
    pages: policy.pages ?? DEFAULT_PAGES_CACHE
  };
}

/**
 * Compose the generated rule blocks: the catch-all revalidation rule FIRST, then
 * one immutable rule per fingerprinted bundle file. Cloudflare applies every
 * matching rule and comma-joins duplicate headers (it does NOT override), so each
 * per-file rule must detach the catch-all's `Cache-Control` (`! Cache-Control`)
 * before attaching its own — otherwise a bundle would be served with two joined,
 * contradictory `Cache-Control` values.
 *
 * @param files - The fingerprinted bundle web paths (publish-root-relative).
 * @param policy - The resolved `Cache-Control` values.
 * @param policy.assets - The value for fingerprinted bundles.
 * @param policy.pages - The catch-all value for everything else.
 * @returns The generated rule blocks, in emission order.
 * @example
 * ```ts
 * composeRules(["assets/main-abc123.css"], { assets: "…", pages: "…" });
 * ```
 */
function composeRules(
  files: readonly string[],
  policy: { assets: string; pages: string }
): string[] {
  const catchAll = `/*\n  Cache-Control: ${policy.pages}`;
  const perFile = files.map(
    file => `/${file}\n  ! Cache-Control\n  Cache-Control: ${policy.assets}`
  );
  return [catchAll, ...perFile];
}

/**
 * Read the app's own `<publicDir>/_headers` SOURCE file (not the copy the public
 * phase may have placed in outDir — composing from the source keeps this phase
 * idempotent and independent of phase ordering). Returns `""` when absent.
 *
 * @param publicDir - The configured public directory (or the default).
 * @returns The app's `_headers` content, or `""` when the file does not exist.
 * @example
 * ```ts
 * const appRules = await readAppHeaders("public");
 * ```
 */
async function readAppHeaders(publicDir: string): Promise<string> {
  const source = path.join(publicDir, "_headers");
  if (!existsSync(source)) return "";
  return readFile(source, "utf8");
}

/**
 * Emits `outDir/_headers`: the generated cache rules (catch-all revalidation +
 * per-file immutable bundle rules) followed by the app's own
 * `<publicDir>/_headers` content. App rules come LAST so they can override a
 * generated header — note Cloudflare comma-joins duplicates, so an app rule that
 * re-sets a generated header must detach it first (`! Cache-Control`). Overwrites
 * the verbatim copy the public phase made, which is why this phase must run after
 * the outputs phase group.
 *
 * @param ctx - Plugin context (provides `state`, `config`, `log`).
 * @returns The written file path + generated rule count.
 * @example
 * ```ts
 * const result = await generateCacheHeaders(ctx);
 * ```
 */
export async function generateCacheHeaders(ctx: PhaseContext): Promise<CacheHeadersResult> {
  const { outDir, publicDir, cacheHeaders } = ctx.config;
  const policy = resolvePolicy(cacheHeaders);

  // Every fingerprinted bundler output (entries + lazy chunks, both kinds) gets a
  // per-file rule — `assets/` also holds NON-hashed files copied verbatim from
  // public/static, so a directory-wide immutable rule would poison those; exact
  // file rules cannot.
  const files = [...readBundleOutputs(ctx, "css"), ...readBundleOutputs(ctx, "js")].toSorted();

  // Compose generated rules + the app's own rules (app last, so the app wins).
  const rules = composeRules(files, policy);
  const appHeadersRaw = await readAppHeaders(publicDir ?? DEFAULT_PUBLIC_DIR);
  const appHeaders = appHeadersRaw.trim();
  const blocks = appHeaders === "" ? rules : [...rules, appHeaders];
  const content = `${blocks.join("\n\n")}\n`;

  // Cloudflare ignores rules past its cap — warn so a huge site notices.
  if (rules.length > CLOUDFLARE_RULE_LIMIT) {
    ctx.log.warn("build:cache-headers", { rules: rules.length, limit: CLOUDFLARE_RULE_LIMIT });
  }

  // Persist, overwriting any verbatim `_headers` copy from the public phase.
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, "_headers");
  await writeFile(file, content, "utf8");
  ctx.log.debug("build:cache-headers", { path: file, rules: rules.length });
  return { path: file, ruleCount: rules.length };
}
