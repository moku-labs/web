/**
 * @file build phase 3 — pages. Pulls `router.manifest()` + `head.render(route, data)`
 * and SSR-renders each route to static HTML (preact-render-to-string). Appends the
 * build-id meta tag after `head.render()` returns. Does NOT compose `<head>` itself.
 *
 * Pipeline (top-down): {@link renderPages} orchestrates → {@link expandAllInstances}
 * (manifest → per-locale {@link PageInstance}s) → {@link renderInstance} (one page:
 * {@link loadRouteData} → {@link composeHeadHtml} → {@link renderBody} →
 * {@link writeDocument}) → {@link writeDataSidecars} (hybrid/spa data) →
 * {@link findRootHtml}.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderToString } from "preact-render-to-string";
import { dataPlugin } from "../../data";
import type { DataEntry } from "../../data/types";
import { headPlugin } from "../../head";
import type {
  HeadConfig as ComposedHeadConfig,
  HeadElement,
  ResolvedRoute
} from "../../head/types";
import { i18nPlugin } from "../../i18n";
import { routerPlugin } from "../../router";
import { isClientOnlyRoute } from "../../router/iso-match";
import type {
  GenerateContext,
  HeadConfig,
  LoadContext,
  RouteContext,
  RouteDefinition,
  RouteState,
  TypedRoute
} from "../../router/types";
import type { PhaseContext } from "../types";
import {
  ASSETS_PLACEHOLDER,
  buildAssetTags,
  CSS_ASSETS_PLACEHOLDER,
  JS_ASSETS_PLACEHOLDER
} from "./asset-tags";

/** Template placeholder for the composed `<head>` inner HTML. */
const HEAD_PLACEHOLDER = "<!--moku:head-->";
/** Template placeholder for the SSR-rendered body HTML. */
const BODY_PLACEHOLDER = "<!--moku:body-->";
/** Template placeholder for the page's locale (`<html lang>`). */
const LANG_PLACEHOLDER = "<!--moku:lang-->";

/** Result of the pages phase: page count + the captured root/default-page HTML. */
export type PagesResult = {
  /** Number of route instances written. */
  pageCount: number;
  /** The default (root `/`) page HTML, captured for the root-index phase. */
  rootHtml: string | null;
};

/** A single concrete page instance to render (a route expanded for one param set). */
type PageInstance = {
  /** The owning route definition. */
  readonly definition: RouteDefinition;
  /**
   * The router's compiled `TypedRoute` for this definition, correlated by
   * `pattern`. The single source of truth for on-disk write paths (`toFile`) and
   * canonical URLs (`toUrl`) — `build` never re-derives these from the pattern,
   * which is what lets a route's `.toFile()` override take effect.
   */
  readonly entry: TypedRoute;
  /** The route name (the route-map key, from the correlated `TypedRoute`). */
  readonly name: string;
  /** The resolved params for this instance. */
  readonly params: Record<string, string>;
  /** The active locale for this instance. */
  readonly locale: string;
};

/** A rendered page: its canonical URL, HTML, loaded data, and client-nav flag. */
type RenderedPage = {
  /** The page's canonical URL (from `entry.toUrl`). */
  readonly url: string;
  /** The complete rendered HTML document. */
  readonly html: string;
  /** The route's loaded data (`{}` when it has no `.load()`); reused for the sidecar. */
  readonly data: unknown;
  /** Whether the route is client-navigable (has a `.render()` → always gets a sidecar). */
  readonly clientNavigable: boolean;
};

/** The pieces composed into a page document (shared by in-code shell + template fill). */
type DocumentParts = {
  /** Composed `<head>` inner HTML from `head.render` + the build-id meta. */
  head: string;
  /** SSR-rendered body HTML. */
  body: string;
  /** Injected asset `<link>`/`<script>` tags (empty when injection is off). */
  assets: string;
  /** The stylesheet `<link>` tags ONLY (the split `<!--moku:assets:css-->` placeholder). */
  assetsCss: string;
  /** The `<script>` tags ONLY (the split `<!--moku:assets:js-->` placeholder). */
  assetsJs: string;
  /** Page locale for the `<html lang>` attribute / shell. */
  locale: string;
};

/** Shared per-build render wiring: precomputed asset tags + the optional shell template. */
type RenderShell = {
  /** The injected asset `<link>`/`<script>` tags (computed once). */
  readonly assets: string;
  /** The stylesheet `<link>` tags ONLY (computed once, for the split placeholder). */
  readonly assetsCss: string;
  /** The `<script>` tags ONLY (computed once, for the split placeholder). */
  readonly assetsJs: string;
  /** The shell template HTML, or `null` to use the in-code shell. */
  readonly template: string | null;
  /**
   * The i18n default locale. It is served at BARE paths (the canonical URL); each
   * default-locale page on a `{lang:?}` route is ALSO emitted at `/{defaultLocale}/`
   * (a content-identical alias whose canonical already points to bare), so explicit
   * `/{defaultLocale}/…` links keep resolving with no redirect.
   */
  readonly defaultLocale: string;
};

/**
 * Compose the full static HTML document with the in-code shell, injecting the
 * build-id meta tag into `<head>` AFTER the head plugin's composed HTML (build
 * metadata, not content) and the asset tags at the end of `<head>`.
 *
 * @param parts - The composed head/body/assets/locale pieces.
 * @returns The complete HTML document string.
 * @example
 * ```ts
 * renderDocument({ head: "<title>Hi</title>", body: "<h1>Hi</h1>", assets: "", locale: "en" });
 * ```
 */
function renderDocument(parts: DocumentParts): string {
  // `charset` first (must land in the document's first bytes) and `viewport` next — both are
  // document-scaffold concerns the shell owns, NOT route SEO. Without `width=device-width`,
  // mobile browsers assume a ~980px desktop canvas and paint the desktop layout.
  const scaffold =
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
  return `<!DOCTYPE html><html lang="${parts.locale}"><head>${scaffold}${parts.head}${parts.assets}</head><body>${parts.body}</body></html>`;
}

/**
 * Fill a shell template's `<!--moku:lang-->` / `<!--moku:head-->` /
 * `<!--moku:body-->` / `<!--moku:assets-->` placeholders deterministically at build
 * time. `<!--moku:lang-->` carries the page locale (for `<html lang>`), so a single
 * shared template stays locale-correct across every locale. The split
 * `<!--moku:assets:css-->` / `<!--moku:assets:js-->` placeholders inject one asset
 * kind each — for shells that, e.g., link stylesheets in `<head>` but place
 * scripts at the end of `<body>`.
 *
 * @param template - The raw shell template HTML.
 * @param parts - The composed head/body/assets/locale pieces.
 * @returns The filled document string.
 * @example
 * ```ts
 * fillTemplate(shell, { head, body, assets, assetsCss, assetsJs, locale: "en" });
 * ```
 */
function fillTemplate(template: string, parts: DocumentParts): string {
  return template
    .replaceAll(LANG_PLACEHOLDER, parts.locale)
    .replaceAll(HEAD_PLACEHOLDER, parts.head)
    .replaceAll(BODY_PLACEHOLDER, parts.body)
    .replaceAll(ASSETS_PLACEHOLDER, parts.assets)
    .replaceAll(CSS_ASSETS_PLACEHOLDER, parts.assetsCss)
    .replaceAll(JS_ASSETS_PLACEHOLDER, parts.assetsJs);
}

/**
 * Resolve the compiled entry for a manifest definition, asserting the router
 * invariant that `manifest()` and `entries()` stay in sync (see {@link makeEntryMap}).
 *
 * @param byPattern - The pattern→compiled-`TypedRoute` index.
 * @param definition - The route definition from the manifest.
 * @returns The compiled `TypedRoute` for the definition's pattern.
 * @throws {Error} When no compiled entry exists for the definition's pattern.
 * @example
 * ```ts
 * const entry = resolveEntry(byPattern, definition);
 * ```
 */
function resolveEntry(byPattern: Map<string, TypedRoute>, definition: RouteDefinition): TypedRoute {
  const entry = byPattern.get(definition.pattern);
  if (!entry) {
    throw new Error(
      `[web] build.pages: no router entry for pattern "${definition.pattern}" — ` +
        "router.manifest() and router.entries() are out of sync."
    );
  }
  return entry;
}

/**
 * Produce the param sets one route generates for a single locale: the route's
 * `.generate(ctx)` result when present, else a single empty-params instance. The
 * generate context is the spec `{ locale, require, has }`, so a `.generate()` handler
 * pulls sibling APIs the spec way.
 *
 * In `spa` mode a client-only route (dynamic, no `.generate()`) is SKIPPED entirely
 * (`[]`) — it is rendered on the client from the URL, so emitting a static param-less
 * shell here would only write a file at the wrong path (a 404 for any real param path)
 * carrying no param. See {@link isClientOnlyRoute}.
 *
 * @param definition - The route definition from the manifest.
 * @param locale - The active locale to generate param sets for.
 * @param mode - The global render mode (`router.mode()`); gates the spa client-only skip.
 * @param ctx - Plugin context (provides `require`/`has` for the generate context).
 * @returns The param sets for this route+locale (`[{}]` when there is no `.generate()`; `[]` when client-only).
 * @example
 * ```ts
 * const paramSets = await generateParamSets(def, "en", "hybrid", ctx);
 * ```
 */
async function generateParameterSets(
  definition: RouteDefinition,
  locale: string,
  mode: string,
  ctx: Pick<PhaseContext, "require" | "has">
): Promise<unknown[]> {
  // spa client-only route → no static page; the client renders it from the URL.
  if (isClientOnlyRoute(mode, definition)) return [];
  const generateContext: GenerateContext = { locale, require: ctx.require, has: ctx.has };
  return definition._handlers.generate
    ? await definition._handlers.generate(generateContext)
    : [{}];
}

/**
 * Expand one route definition into its concrete page instances across all locales,
 * using `generate?.(ctx)` when present (else a single empty-params instance per
 * locale). The generate context is the spec `{ locale, require, has }`, so a
 * `.generate()` handler pulls sibling APIs the spec way.
 *
 * Instances are deduplicated by resolved output file: a route whose pattern has no
 * lang placeholder (or whose `generate()` params omit `lang`) resolves to the SAME
 * `toFile` path for EVERY locale — without the guard each locale's render races on
 * one output file and the shipped HTML's locale is nondeterministic. The default
 * locale is expanded FIRST, so a collapsed route keeps its default-locale instance.
 *
 * @param definition - The route definition from the manifest.
 * @param locales - Active locale codes from i18n.
 * @param defaultLocale - The i18n default locale (kept when locales collapse to one file).
 * @param byPattern - Pattern→compiled-`TypedRoute` map (see {@link makeEntryMap}).
 * @param mode - The global render mode (`router.mode()`); gates the spa client-only skip.
 * @param ctx - Plugin context (provides `require`/`has` for the generate context).
 * @returns The flattened, file-deduplicated list of page instances for this route.
 * @example
 * ```ts
 * await expandRoute(def, ["en"], "en", byPattern, "hybrid", ctx);
 * ```
 */
async function expandRoute(
  definition: RouteDefinition,
  locales: readonly string[],
  defaultLocale: string,
  byPattern: Map<string, TypedRoute>,
  mode: string,
  ctx: Pick<PhaseContext, "require" | "has">
): Promise<PageInstance[]> {
  // Correlate the definition to its compiled entry (the URL/file-path source of truth).
  const entry = resolveEntry(byPattern, definition);
  const { name } = entry;

  // Fan out across locales — default locale first, so when instances collapse to one
  // output file below, the surviving (first-claiming) instance is the default-locale one.
  const orderedLocales = [defaultLocale, ...locales.filter(locale => locale !== defaultLocale)];

  // Expand each route+locale into its generated param sets.
  const instances: PageInstance[] = [];
  const claimedFiles = new Set<string>();
  for (const locale of orderedLocales) {
    const parameterSets = await generateParameterSets(definition, locale, mode, ctx);

    // Materialize one page instance per generated param set — skipping any instance
    // whose resolved output file is already claimed (the locale fan-out collapsed).
    for (const raw of parameterSets) {
      const params = (raw ?? {}) as Record<string, string>;
      const file = entry.toFile(params);
      if (claimedFiles.has(file)) continue;
      claimedFiles.add(file);
      instances.push({ definition, entry, name, params, locale });
    }
  }
  return instances;
}

/**
 * Correlate each `manifest()` route definition to its compiled `TypedRoute` from
 * `router.entries()` by `pattern` (the stable key both share). The resulting
 * `TypedRoute` owns URL/file-path derivation (`toUrl`/`toFile`) — including any
 * route-level `.toFile()` override — so `build` never re-derives paths from the
 * raw pattern. Returns an empty map when `entries()` is unavailable (e.g. unit
 * mocks); `expandRoute` then throws for any uncorrelated pattern.
 *
 * @param router - The router plugin API (`entries` may be absent in test mocks).
 * @param router.entries - The optional `entries()` accessor (absent in some test mocks).
 * @returns A map from route pattern to its compiled `TypedRoute`.
 * @example
 * ```ts
 * const byPattern = makeEntryMap(router);
 * byPattern.get("/{slug}/")?.toFile({ slug: "x" }); // "x/index.html"
 * ```
 */
function makeEntryMap(router: { entries?: () => readonly TypedRoute[] }): Map<string, TypedRoute> {
  const byPattern = new Map<string, TypedRoute>();
  if (typeof router.entries === "function") {
    for (const entry of router.entries()) byPattern.set(entry.pattern, entry);
  }
  return byPattern;
}

/**
 * Adapt a route's `.head()` result (`router`'s `HeadConfig`, an open record) into
 * the `head` plugin's composed-head config by mapping its known fields explicitly:
 * `title`/`description`/`canonical`/`image` (strings) and `elements`. This replaces
 * a structural `as unknown as` cast — only the fields `head.render` reads cross the
 * boundary, and each is narrowed to the shape `head` expects.
 *
 * @param config - The `router` `HeadConfig` returned by a route's `.head()` handler.
 * @returns The `head`-plugin `HeadConfig` (omitting absent/ill-typed fields).
 * @example
 * ```ts
 * adaptHeadConfig({ title: "Home", description: "Welcome" });
 * ```
 */
function adaptHeadConfig(config: HeadConfig): ComposedHeadConfig {
  const adapted: ComposedHeadConfig = {};
  if (typeof config.title === "string") adapted.title = config.title;
  if (typeof config.description === "string") adapted.description = config.description;
  if (typeof config.canonical === "string") adapted.canonical = config.canonical;
  if (typeof config.image === "string") adapted.image = config.image;
  if (Array.isArray(config.elements)) adapted.elements = config.elements as HeadElement[];
  return adapted;
}

// ── Per-instance render steps (one PageInstance → one written document) ──────────

/**
 * Run a route's optional, build-only `.load(ctx)` for one instance. The loader
 * receives a {@link LoadContext} (`params` + `locale` + `require`/`has`) so it pulls
 * sibling plugin APIs the spec way (`ctx.require(contentPlugin)`) with no module
 * global. Returns `{}` when the route declares no `.load()`. Never runs on the client.
 *
 * @param definition - The route definition for this instance.
 * @param params - The resolved params for this instance.
 * @param locale - The active locale for this instance.
 * @param ctx - Plugin context (provides `require`/`has` for the load context).
 * @returns The loaded data, or `{}` when the route has no loader.
 * @example
 * ```ts
 * const data = await loadRouteData(def, { slug: "x" }, "en", ctx);
 * ```
 */
async function loadRouteData(
  definition: RouteDefinition,
  params: Record<string, string>,
  locale: string,
  ctx: Pick<PhaseContext, "require" | "has">
): Promise<unknown> {
  if (!definition._handlers.load) return {};
  const loadContext: LoadContext<RouteState> = {
    params,
    locale,
    require: ctx.require,
    has: ctx.has
  };
  return definition._handlers.load(loadContext);
}

/**
 * Compose one page's `<head>` inner HTML: build the {@link ResolvedRoute} identity,
 * adapt the route's `.head()` result into the head plugin's config, run
 * `head.render(resolved, data)`, then append the build-id meta tag (build metadata,
 * emitted AFTER the composed head — never treated as content).
 *
 * @param ctx - Plugin context (provides `require`, `state`).
 * @param instance - The page instance (name/params/locale identity).
 * @param url - The instance's canonical URL (from `entry.toUrl`).
 * @param routeContext - The context passed to the route's `.head()` handler.
 * @param data - The route's loaded data, forwarded to `head.render`.
 * @returns The composed `<head>` inner HTML including the build-id meta tag.
 * @example
 * ```ts
 * const head = composeHeadHtml(ctx, instance, "/en/x/", routeContext, data);
 * ```
 */
function composeHeadHtml(
  ctx: Pick<PhaseContext, "require" | "state">,
  instance: PageInstance,
  url: string,
  routeContext: RouteContext<RouteState>,
  data: unknown
): string {
  const resolved: ResolvedRoute = {
    path: url,
    name: instance.name,
    params: instance.params,
    locale: instance.locale
  };
  const headConfig = instance.definition._handlers.head?.(routeContext);
  if (headConfig) resolved.head = adaptHeadConfig(headConfig);
  const headHtml = ctx.require(headPlugin).render(resolved, data);
  return `${headHtml}<meta name="build-id" content="${ctx.state.runId ?? ""}">`;
}

/**
 * Render one page's body to an HTML string: build the page VNode via the route's
 * `.render()`, wrap it in the route's optional `.layout()` (persistent chrome —
 * SSG-only: the client keeps the chrome and swaps just the inner region, so the
 * layout is NOT re-applied on navigation), then serialize with
 * preact-render-to-string. Returns `""` when the route has no `.render()`.
 *
 * @param definition - The route definition (provides `.render()`/`.layout()`).
 * @param routeContext - The route context (params/data/locale/meta/url); `meta` flows to the layout.
 * @returns The SSR-rendered body HTML, or `""` when the route has no `.render()`.
 * @example
 * ```ts
 * const body = renderBody(definition, routeContext);
 * ```
 */
function renderBody(definition: RouteDefinition, routeContext: RouteContext<RouteState>): string {
  const vnode = definition._handlers.render?.(routeContext);
  if (!vnode) return "";
  const page = definition._handlers.layout
    ? definition._handlers.layout(routeContext, vnode)
    : vnode;
  return renderToString(page);
}

/**
 * Hash a page's render inputs (its loaded data) for the render cache. `null` when the
 * data is not JSON-serializable — such a page is never cached and always re-renders.
 *
 * @param data - The route's loaded data (the only per-page input besides params/locale/code).
 * @returns The hex SHA-256 of the serialized data, or `null` when it cannot be serialized.
 * @example
 * ```ts
 * hashData({ title: "Hi" }); // "9f8e…"
 * ```
 */
function hashData(data: unknown): string | null {
  try {
    // JSON.stringify returns undefined for undefined / functions — coalesce so the hash is
    // always over a string; a throw (circular / BigInt) drops to the never-cache path below.
    const serialized = JSON.stringify(data) ?? "";
    return createHash("sha256").update(serialized).digest("hex");
  } catch {
    // eslint-disable-next-line unicorn/no-null -- `null` = non-serializable data ⇒ never cached
    return null;
  }
}

/**
 * The render-cache key for one page instance: name + params + locale (the stable identity
 * that, together with the data hash, determines its body). NUL-joined so no value collides.
 *
 * @param instance - The page instance.
 * @returns The cache key string.
 * @example
 * ```ts
 * renderCacheKey(instance); // "article {\"slug\":\"x\"} en"
 * ```
 */
function renderCacheKey(instance: PageInstance): string {
  return `${instance.name} ${JSON.stringify(instance.params)} ${instance.locale}`;
}

/**
 * Render one page's body, reusing the cached body when this page's data is unchanged.
 * The body is the synchronous, dominant-cost step ({@link renderBody}); an incremental
 * dev rebuild (`reuse`, code unchanged) skips it for every page whose data hash matches
 * the cache, and a changed page (or a non-`reuse` run) renders + refreshes the cache.
 *
 * @param ctx - Plugin context (provides the cross-run `state.renderCache`).
 * @param instance - The page instance being rendered.
 * @param routeContext - The route context passed to `.render()`/`.layout()`.
 * @param data - The route's loaded data (hashed to detect a change).
 * @param reuse - Whether this run may reuse a cached body (incremental, no code change).
 * @returns The SSR-rendered body HTML.
 * @example
 * ```ts
 * const body = renderBodyCached(ctx, instance, routeContext, data, true);
 * ```
 */
function renderBodyCached(
  ctx: Pick<PhaseContext, "state">,
  instance: PageInstance,
  routeContext: RouteContext<RouteState>,
  data: unknown,
  reuse: boolean
): string {
  const cache = ctx.state.renderCache;
  const key = renderCacheKey(instance);
  const hash = hashData(data);

  // Reuse the cached body only when allowed AND the data is unchanged + serializable.
  if (reuse && hash !== null) {
    const hit = cache.get(key);
    if (hit?.dataHash === hash) return hit.body;
  }

  // Otherwise render the body and (when serializable) refresh the cache entry.
  const body = renderBody(instance.definition, routeContext);
  if (hash !== null) cache.set(key, { dataHash: hash, body });
  return body;
}

/**
 * Write a rendered page document to its on-disk path. The path comes from the
 * compiled `TypedRoute.toFile(params)` (honoring any route-level `.toFile()`
 * override), resolved under the build `outDir`; parent directories are created first.
 *
 * @param outDir - The build output directory.
 * @param entry - The compiled route (owns `toFile` path derivation).
 * @param params - The resolved params for this instance.
 * @param html - The complete HTML document to write.
 * @returns A promise resolved once the file is written.
 * @example
 * ```ts
 * await writeDocument("dist", entry, { slug: "x" }, "<!DOCTYPE html>…");
 * ```
 */
async function writeDocument(
  outDir: string,
  entry: TypedRoute,
  params: Record<string, string>,
  html: string
): Promise<void> {
  await writeDocumentAt(outDir, entry.toFile(params), html);
}

/**
 * Write an HTML document to an explicit relative path under `outDir`, creating parent
 * directories first. Backs both the canonical page path ({@link writeDocument}) and the
 * default-locale `/{defaultLocale}/…` alias copy ({@link renderInstance}).
 *
 * @param outDir - The build output directory.
 * @param relativeFile - The output file path relative to `outDir` (e.g. `en/index.html`).
 * @param html - The complete HTML document to write.
 * @returns A promise resolved once the file is written.
 * @example
 * ```ts
 * await writeDocumentAt("dist", "en/about/index.html", "<!DOCTYPE html>…");
 * ```
 */
async function writeDocumentAt(outDir: string, relativeFile: string, html: string): Promise<void> {
  const filePath = path.join(outDir, relativeFile);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, html, "utf8");
}

/**
 * Render one page instance to its static HTML document and write it to disk. Reads
 * as a five-step pipeline: load data → build the route context → compose
 * `<head>`/body → assemble the document (template fill or in-code shell) → write.
 * Uses the configured shell `template` when supplied, otherwise the in-code shell.
 *
 * The default locale is served at BARE paths, so each default-locale page on a
 * `{lang:?}` route is ALSO written to `/{defaultLocale}/…` — the SAME rendered HTML (its
 * canonical already points at the bare URL) — so an explicit `/{defaultLocale}/…` link
 * serves the page directly with no redirect. Both pages are returned so each gets a sidecar.
 *
 * @param ctx - Plugin context (provides `require`, `state`, `config`, `has`).
 * @param instance - The concrete page instance to render.
 * @param shell - Per-build wiring shared across instances (asset tags + template + default locale).
 * @param reuse - Whether this run may reuse a cached body (incremental, no code change).
 * @returns The rendered page(s): the canonical page, plus the `/{defaultLocale}/` alias when emitted.
 * @example
 * ```ts
 * await renderInstance(ctx, instance, shell, false);
 * ```
 */
async function renderInstance(
  ctx: Pick<PhaseContext, "require" | "state" | "config" | "has">,
  instance: PageInstance,
  shell: RenderShell,
  reuse: boolean
): Promise<RenderedPage[]> {
  const { definition, entry, params, locale } = instance;
  const router = ctx.require(routerPlugin);

  // Load build-only data and assemble the route context the handlers receive.
  const data = await loadRouteData(definition, params, locale, ctx);
  const url = entry.toUrl(params);
  const routeContext: RouteContext<RouteState> = {
    params,
    data,
    locale,
    meta: definition._meta,
    // eslint-disable-next-line jsdoc/require-jsdoc -- inline link builder; delegates to router.toUrl
    url: (routeName, routeParams = {}) => router.toUrl(routeName, routeParams)
  };

  // Compose the page's head and body into the document parts (body reused from the
  // render cache when this page's data is unchanged on an incremental rebuild).
  const parts: DocumentParts = {
    head: composeHeadHtml(ctx, instance, url, routeContext, data),
    body: renderBodyCached(ctx, instance, routeContext, data, reuse),
    assets: shell.assets,
    assetsCss: shell.assetsCss,
    assetsJs: shell.assetsJs,
    locale
  };

  // Assemble the full document — shell template when configured, else the in-code shell.
  const html =
    shell.template === null ? renderDocument(parts) : fillTemplate(shell.template, parts);

  // Persist the canonical document. A route with a `.render()` is client-navigable and so
  // always gets a data sidecar (see writeDataSidecars).
  await writeDocument(ctx.config.outDir, entry, params, html);
  const clientNavigable = definition._handlers.render !== undefined;
  const pages: RenderedPage[] = [{ url, html, data, clientNavigable }];

  // Default locale served bare: also emit the content-identical `/{defaultLocale}/` alias
  // so explicit prefixed links resolve without a redirect (canonical still points to bare).
  if (locale === shell.defaultLocale && entry.pattern.includes("{lang:?}")) {
    await writeDocumentAt(
      ctx.config.outDir,
      `${shell.defaultLocale}/${entry.toFile(params)}`,
      html
    );
    pages.push({ url: `/${shell.defaultLocale}${url}`, html, data, clientNavigable });
  }
  return pages;
}

// ── Phase orchestration (manifest → all pages → data sidecars → root capture) ────

/**
 * Prepare the per-build {@link RenderShell} ONCE (O(1) per page): read the optional
 * shell `template` from disk when configured + present, and precompute the injected
 * asset tags. `template` is `null` when unset/missing (use the in-code shell).
 *
 * @param ctx - Plugin context (provides `config`, `state`, `require`).
 * @returns The shared shell wiring (asset tags + template-or-null + default locale) for every page.
 * @example
 * ```ts
 * const shell = await prepareShell(ctx);
 * ```
 */
async function prepareShell(
  ctx: Pick<PhaseContext, "state" | "config" | "require">
): Promise<RenderShell> {
  const templatePath = ctx.config.template;
  const template =
    typeof templatePath === "string" && existsSync(templatePath)
      ? await readFile(templatePath, "utf8")
      : // eslint-disable-next-line unicorn/no-null -- `null` = use the in-code shell
        null;
  return {
    assets: buildAssetTags(ctx),
    assetsCss: buildAssetTags(ctx, "css"),
    assetsJs: buildAssetTags(ctx, "js"),
    template,
    defaultLocale: ctx.require(i18nPlugin).defaultLocale()
  };
}

/**
 * Expand every manifest route into its concrete page instances across all locales
 * (delegating per-route expansion — and per-route output-file deduplication — to
 * {@link expandRoute}) and flatten the result.
 *
 * @param manifest - The route definitions from `router.manifest()`.
 * @param locales - Active locale codes from i18n.
 * @param defaultLocale - The i18n default locale (kept when a route's locales collapse).
 * @param byPattern - Pattern→compiled-`TypedRoute` map (see {@link makeEntryMap}).
 * @param mode - The global render mode (`router.mode()`); gates the spa client-only skip.
 * @param ctx - Plugin context (provides `require`/`has` for generate contexts).
 * @returns The flattened list of page instances to render.
 * @example
 * ```ts
 * const instances = await expandAllInstances(manifest, ["en"], "en", byPattern, "hybrid", ctx);
 * ```
 */
async function expandAllInstances(
  manifest: readonly RouteDefinition[],
  locales: readonly string[],
  defaultLocale: string,
  byPattern: Map<string, TypedRoute>,
  mode: string,
  ctx: Pick<PhaseContext, "require" | "has">
): Promise<PageInstance[]> {
  const lists = await Promise.all(
    manifest.map(definition =>
      expandRoute(definition, locales, defaultLocale, byPattern, mode, ctx)
    )
  );
  return lists.flat();
}

/**
 * Persist per-page client-data sidecars when the app opts into client navigation
 * (`mode !== "ssg"`) and the `data` plugin is composed. ONE route expansion feeds
 * both the HTML and these sidecars — no duplicate loads. Only client-navigable pages
 * (those with a `.render()`) get a sidecar (`{}` when there is no `.load()`), so
 * hybrid data-nav resolves cleanly instead of falling back to a full HTML fetch.
 *
 * @param ctx - Plugin context (provides `require`, `has`, `config`, `log`).
 * @param rendered - The rendered pages (url + data + client-navigable flag).
 * @param mode - The global render mode from `router.mode()`.
 * @returns A promise resolved once sidecars are written (no-op for `"ssg"`).
 * @example
 * ```ts
 * await writeDataSidecars(ctx, rendered, "hybrid");
 * ```
 */
async function writeDataSidecars(
  ctx: Pick<PhaseContext, "require" | "has" | "config" | "log">,
  rendered: readonly RenderedPage[],
  mode: string
): Promise<void> {
  if (mode === "ssg" || !ctx.has("data")) return;
  const entries: DataEntry[] = rendered
    .filter(page => page.clientNavigable)
    .map(page => ({ path: page.url, data: page.data }));
  if (entries.length === 0) return;
  const summary = await ctx.require(dataPlugin).write(entries, { outDir: ctx.config.outDir });
  ctx.log.debug("build:data", { files: summary.fileCount, bytes: summary.bytes });
}

/**
 * Find the default (root `/`) page's HTML among the rendered pages, captured for the
 * root-index phase. Matches the `/` or `""` (empty) root URL.
 *
 * @param rendered - The rendered pages.
 * @returns The root page's HTML, or `null` when no root page was rendered.
 * @example
 * ```ts
 * const rootHtml = findRootHtml(rendered);
 * ```
 */
function findRootHtml(rendered: readonly RenderedPage[]): string | null {
  const root = rendered.find(page => page.url === "/" || page.url === "");
  // eslint-disable-next-line unicorn/no-null -- `null` = no root page captured (PagesResult contract)
  return root?.html ?? null;
}

/**
 * Pages rendered concurrently per batch. Kept small so the macrotask yield between
 * batches fires frequently — a large batch renders for seconds before yielding, which
 * leaves a watching dev server's spinner repainting only every few seconds (sluggish).
 * Smaller batches trade a little write-concurrency for a smooth, responsive spinner.
 */
const RENDER_BATCH_SIZE = 2;

/**
 * Batch size for an incremental (`reuse`) rebuild. Most instances are cheap cache hits, so
 * a larger batch cuts the per-batch `setImmediate` round-trips (which would otherwise add
 * pure latency to an otherwise-fast rebuild) without starving the dev spinner.
 */
const INCREMENTAL_BATCH_SIZE = 32;

/**
 * Render `items` through `worker` in bounded-size batches, yielding a macrotask
 * (`setImmediate`) between batches. Beyond bounding peak concurrency/memory for large
 * sites, the yield lets the single JS thread breathe: one un-yielded `Promise.all` over
 * hundreds of synchronous `renderToString` calls starves the event loop, which freezes a
 * watching dev server's progress spinner until the whole phase resolves. Output order is
 * preserved (batch order + `Promise.all` order within a batch).
 *
 * @template Item - The input item type.
 * @template Out - The rendered output type.
 * @param items - The items to render.
 * @param batchSize - Maximum items rendered concurrently per batch.
 * @param worker - Renders one item to its output.
 * @returns All rendered outputs in input order.
 * @example
 * ```ts
 * const pages = await renderInBatches(instances, 32, i => renderInstance(ctx, i, shell));
 * ```
 */
async function renderInBatches<Item, Out>(
  items: readonly Item[],
  batchSize: number,
  worker: (item: Item) => Promise<Out>
): Promise<Out[]> {
  const out: Out[] = [];
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    out.push(...(await Promise.all(batch.map(item => worker(item)))));
    const hasMore = start + batchSize < items.length;
    if (hasMore) {
      await new Promise<void>(resolve => {
        setImmediate(resolve);
      });
    }
  }
  return out;
}

/**
 * Renders every route in the manifest to `outDir/<path>/index.html`. Reads as a
 * pipeline: resolve deps → prepare the shared shell → expand instances → render in
 * bounded batches ({@link renderInBatches}) → write data sidecars (hybrid/spa) →
 * capture the root page's HTML for the root-index phase.
 *
 * On an incremental rebuild (`options.reuse`) the cross-run render cache is kept and each
 * unchanged-data page reuses its cached body; a full render clears the cache first so a
 * removed/renamed route's stale body never lingers.
 *
 * @param ctx - Plugin context (provides `require`, `state`, `config`, `log`, `has`).
 * @param options - Optional incremental hint; omit for a full render.
 * @param options.reuse - Reuse cached page bodies for unchanged-data pages (dev incremental rebuild).
 * @returns The number of pages rendered and the captured default-page HTML.
 * @example
 * ```ts
 * const { pageCount, rootHtml } = await renderPages(ctx);
 * ```
 */
export async function renderPages(
  ctx: Pick<PhaseContext, "require" | "state" | "config" | "log" | "has">,
  options?: { reuse?: boolean }
): Promise<PagesResult> {
  // Resolve dependencies + snapshot the manifest into state for later phases.
  const reuse = options?.reuse === true;
  const router = ctx.require(routerPlugin);
  const mode = router.mode();
  const manifest = router.manifest();
  ctx.state.manifest = [...manifest];
  const locales = ctx.require(i18nPlugin).locales();
  const byPattern = makeEntryMap(router);

  // A full render drops the stale render cache (so removed/renamed routes never linger);
  // an incremental render keeps it to reuse the body of any page whose data is unchanged.
  if (!reuse) ctx.state.renderCache.clear();

  // Expand → render every page instance (shell read + asset tags computed once). Rendered
  // in bounded batches with a macrotask yield between them so a watching dev server's
  // spinner keeps animating instead of freezing for the whole (large) phase.
  const shell = await prepareShell(ctx);
  const instances = await expandAllInstances(
    manifest,
    locales,
    shell.defaultLocale,
    byPattern,
    mode,
    ctx
  );
  const batchSize = reuse ? INCREMENTAL_BATCH_SIZE : RENDER_BATCH_SIZE;
  // Each instance yields one canonical page plus, for the default locale, its bare
  // `/{defaultLocale}/` alias — flatten so both feed sidecar writing + root capture.
  const renderedBatches = await renderInBatches(instances, batchSize, instance =>
    renderInstance(ctx, instance, shell, reuse)
  );
  const rendered = renderedBatches.flat();

  // Persist client-data sidecars (hybrid/spa) + capture the root page for root-index.
  await writeDataSidecars(ctx, rendered, mode);
  ctx.log.debug("build:pages", { count: rendered.length });
  return { pageCount: rendered.length, rootHtml: findRootHtml(rendered) };
}
