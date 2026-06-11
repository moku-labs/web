/**
 * @file build — shared asset-tag helpers. Reads the bundle phase's fingerprinted
 * manifests from `state.buildCache` and renders the `<link>`/`<script>` tags that
 * the pages and not-found phases substitute for the `<!--moku:assets-->` family of
 * placeholders. Lives outside both phases so neither imports the other.
 */
import type { BuildCacheEntry, PhaseContext } from "../types";

/** Template placeholder for the injected asset tags (stylesheets + scripts). */
export const ASSETS_PLACEHOLDER = "<!--moku:assets-->";
/** Template placeholder for the injected stylesheet `<link>` tags ONLY. */
export const CSS_ASSETS_PLACEHOLDER = "<!--moku:assets:css-->";
/** Template placeholder for the injected `<script>` tags ONLY. */
export const JS_ASSETS_PLACEHOLDER = "<!--moku:assets:js-->";

/**
 * Read the bundle phase's fingerprinted asset manifest for one kind from
 * `state.buildCache` as a typed {@link BuildCacheEntry} (no `Map<string, unknown>`
 * reads at call sites).
 *
 * @param ctx - Plugin context (provides `state`).
 * @param kind - The asset kind key (`"css"` / `"js"`).
 * @returns The fingerprinted-path manifest entry, or an empty object when absent.
 * @example
 * ```ts
 * readManifest(ctx, "css"); // { "main.css": "assets/main-abc123.css" }
 * ```
 */
export function readManifest(
  ctx: Pick<PhaseContext, "state">,
  kind: "css" | "js"
): BuildCacheEntry {
  const entry = ctx.state.buildCache.get(kind);
  return entry && typeof entry === "object" ? (entry as BuildCacheEntry) : {};
}

/**
 * Read the bundle phase's COMPLETE output list for one kind (entries + lazy split
 * chunks, web paths relative to the publish root) from `state.buildCache`. Unlike
 * {@link readManifest} this includes chunks — it feeds the cache-headers phase's
 * per-file immutable rules, where every fingerprinted file counts, not just the
 * eagerly embedded entries.
 *
 * @param ctx - Plugin context (provides `state`).
 * @param kind - The asset kind key (`"css"` / `"js"`).
 * @returns The publish-root-relative output paths, or an empty array when absent.
 * @example
 * ```ts
 * readBundleOutputs(ctx, "js"); // ["assets/spa-abc123.js", "assets/chunk-9f8e.js"]
 * ```
 */
export function readBundleOutputs(
  ctx: Pick<PhaseContext, "state">,
  kind: "css" | "js"
): readonly string[] {
  const entry = ctx.state.buildCache.get(`${kind}:outputs`);
  return Array.isArray(entry) ? (entry as string[]) : [];
}

/**
 * Render the stylesheet `<link>` tags for the fingerprinted CSS manifest.
 *
 * @param ctx - Plugin context (provides `state`).
 * @returns The concatenated `<link rel="stylesheet">` tags (possibly `""`).
 * @example
 * ```ts
 * buildCssTags(ctx); // '<link rel="stylesheet" href="/assets/main-abc123.css">'
 * ```
 */
function buildCssTags(ctx: Pick<PhaseContext, "state">): string {
  return Object.values(readManifest(ctx, "css"))
    .map(href => `<link rel="stylesheet" href="/${href}">`)
    .join("");
}

/**
 * Render the module `<script>` tags for the fingerprinted JS manifest.
 *
 * @param ctx - Plugin context (provides `state`).
 * @returns The concatenated `<script type="module">` tags (possibly `""`).
 * @example
 * ```ts
 * buildJsTags(ctx); // '<script type="module" src="/assets/spa-abc123.js"></script>'
 * ```
 */
function buildJsTags(ctx: Pick<PhaseContext, "state">): string {
  return Object.values(readManifest(ctx, "js"))
    .map(src => `<script type="module" src="/${src}"></script>`)
    .join("");
}

/**
 * Build the asset tag block from the fingerprinted manifests — both kinds by
 * default, or a single kind for the split `<!--moku:assets:css/js-->`
 * placeholders. Returns an empty string when `config.injectAssets === false`.
 * Asset paths are emitted as absolute (`/`-rooted) URLs.
 *
 * @param ctx - Plugin context (provides `state`, `config`).
 * @param kind - Restrict the block to one asset kind; omit for stylesheets + scripts.
 * @returns The injected asset tags, or `""` when injection is disabled.
 * @example
 * ```ts
 * buildAssetTags(ctx);        // <link …><script …></script>
 * buildAssetTags(ctx, "css"); // <link …> only
 * ```
 */
export function buildAssetTags(
  ctx: Pick<PhaseContext, "state" | "config">,
  kind?: "css" | "js"
): string {
  if (ctx.config.injectAssets === false) return "";
  if (kind === "css") return buildCssTags(ctx);
  if (kind === "js") return buildJsTags(ctx);
  return buildCssTags(ctx) + buildJsTags(ctx);
}

/**
 * Substitute every `<!--moku:assets-->` family placeholder in a complete HTML
 * document: the combined block, the CSS-only block, and the JS-only block. A
 * document without placeholders passes through byte-identical — substitution is
 * strictly opt-in for app-owned pages (the not-found page).
 *
 * @param ctx - Plugin context (provides `state`, `config`).
 * @param html - The HTML document to substitute placeholders in.
 * @returns The document with all asset placeholders replaced.
 * @example
 * ```ts
 * substituteAssetPlaceholders(ctx, "<head><!--moku:assets:css--></head>");
 * ```
 */
export function substituteAssetPlaceholders(
  ctx: Pick<PhaseContext, "state" | "config">,
  html: string
): string {
  return html
    .replaceAll(ASSETS_PLACEHOLDER, buildAssetTags(ctx))
    .replaceAll(CSS_ASSETS_PLACEHOLDER, buildAssetTags(ctx, "css"))
    .replaceAll(JS_ASSETS_PLACEHOLDER, buildAssetTags(ctx, "js"));
}
