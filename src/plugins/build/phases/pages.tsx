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
import type {
  GenerateContext,
  HeadConfig,
  LayoutContext,
  LoadContext,
  RouteContext,
  RouteDefinition,
  RouteState,
  TypedRoute
} from "../../router/types";
import type { BuildCacheEntry, PhaseContext } from "../types";

/** Template placeholder for the composed `<head>` inner HTML. */
const HEAD_PLACEHOLDER = "<!--moku:head-->";
/** Template placeholder for the SSR-rendered body HTML. */
const BODY_PLACEHOLDER = "<!--moku:body-->";
/** Template placeholder for the injected asset `<link>`/`<script>` tags. */
const ASSETS_PLACEHOLDER = "<!--moku:assets-->";

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
  /** Page locale for the `<html lang>` attribute / shell. */
  locale: string;
};

/** Shared per-build render wiring: precomputed asset tags + the optional shell template. */
type RenderShell = {
  /** The injected asset `<link>`/`<script>` tags (computed once). */
  readonly assets: string;
  /** The shell template HTML, or `null` to use the in-code shell. */
  readonly template: string | null;
};

/**
 * Read the bundle phase's hashed asset manifest for one kind from `state.buildCache`
 * as a typed {@link BuildCacheEntry} (no `Map<string, unknown>` reads).
 *
 * @param ctx - Plugin context (provides `state`).
 * @param kind - The asset kind key (`"css"` / `"js"`).
 * @returns The hashed-path manifest entry, or an empty object when absent.
 * @example
 * ```ts
 * readManifest(ctx, "css");
 * ```
 */
function readManifest(ctx: Pick<PhaseContext, "state">, kind: "css" | "js"): BuildCacheEntry {
  const entry = ctx.state.buildCache.get(kind);
  return entry && typeof entry === "object" ? (entry as BuildCacheEntry) : {};
}

/**
 * Build the asset `<link>`/`<script>` tag block from the hashed manifests. Returns
 * an empty string when `config.injectAssets === false`. Asset paths are emitted as
 * absolute (`/`-rooted) URLs.
 *
 * @param ctx - Plugin context (provides `state`, `config`).
 * @returns The injected asset tags, or `""` when injection is disabled.
 * @example
 * ```ts
 * buildAssetTags(ctx);
 * ```
 */
function buildAssetTags(ctx: Pick<PhaseContext, "state" | "config">): string {
  if (ctx.config.injectAssets === false) return "";
  const css = Object.values(readManifest(ctx, "css")).map(
    href => `<link rel="stylesheet" href="/${href}">`
  );
  const js = Object.values(readManifest(ctx, "js")).map(
    src => `<script type="module" src="/${src}"></script>`
  );
  return [...css, ...js].join("");
}

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
  return `<!DOCTYPE html><html lang="${parts.locale}"><head>${parts.head}${parts.assets}</head><body>${parts.body}</body></html>`;
}

/**
 * Fill a shell template's `<!--moku:head-->` / `<!--moku:body-->` /
 * `<!--moku:assets-->` placeholders deterministically at build time.
 *
 * @param template - The raw shell template HTML.
 * @param parts - The composed head/body/assets pieces.
 * @returns The filled document string.
 * @example
 * ```ts
 * fillTemplate(shell, { head, body, assets, locale: "en" });
 * ```
 */
function fillTemplate(template: string, parts: DocumentParts): string {
  return template
    .replaceAll(HEAD_PLACEHOLDER, parts.head)
    .replaceAll(BODY_PLACEHOLDER, parts.body)
    .replaceAll(ASSETS_PLACEHOLDER, parts.assets);
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
 * @param definition - The route definition from the manifest.
 * @param locale - The active locale to generate param sets for.
 * @param ctx - Plugin context (provides `require`/`has` for the generate context).
 * @returns The param sets for this route+locale (`[{}]` when there is no `.generate()`).
 * @example
 * ```ts
 * const paramSets = await generateParamSets(def, "en", ctx);
 * ```
 */
async function generateParameterSets(
  definition: RouteDefinition,
  locale: string,
  ctx: Pick<PhaseContext, "require" | "has">
): Promise<unknown[]> {
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
 * @param definition - The route definition from the manifest.
 * @param locales - Active locale codes from i18n.
 * @param byPattern - Pattern→compiled-`TypedRoute` map (see {@link makeEntryMap}).
 * @param ctx - Plugin context (provides `require`/`has` for the generate context).
 * @returns The flattened list of page instances for this route.
 * @example
 * ```ts
 * await expandRoute(def, ["en"], byPattern, ctx);
 * ```
 */
async function expandRoute(
  definition: RouteDefinition,
  locales: readonly string[],
  byPattern: Map<string, TypedRoute>,
  ctx: Pick<PhaseContext, "require" | "has">
): Promise<PageInstance[]> {
  // Correlate the definition to its compiled entry (the URL/file-path source of truth).
  const entry = resolveEntry(byPattern, definition);
  const { name } = entry;

  // Fan out across locales, expanding each route+locale into its generated param sets.
  const instances: PageInstance[] = [];
  for (const locale of locales) {
    const parameterSets = await generateParameterSets(definition, locale, ctx);

    // Materialize one page instance per generated param set.
    for (const raw of parameterSets) {
      instances.push({
        definition,
        entry,
        name,
        params: (raw ?? {}) as Record<string, string>,
        locale
      });
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
 * @param definition - The route definition (provides `.render()`/`.layout()`/`._meta`).
 * @param routeContext - The route context (params/data/locale/url) — extended with `meta` for the layout.
 * @returns The SSR-rendered body HTML, or `""` when the route has no `.render()`.
 * @example
 * ```ts
 * const body = renderBody(definition, routeContext);
 * ```
 */
function renderBody(definition: RouteDefinition, routeContext: RouteContext<RouteState>): string {
  const vnode = definition._handlers.render?.(routeContext);
  if (!vnode) return "";
  const layoutContext: LayoutContext<RouteState> = { ...routeContext, meta: definition._meta };
  const page = definition._handlers.layout
    ? definition._handlers.layout(layoutContext, vnode)
    : vnode;
  return renderToString(page);
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
  const filePath = path.join(outDir, entry.toFile(params));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, html, "utf8");
}

/**
 * Render one page instance to its static HTML document and write it to disk. Reads
 * as a five-step pipeline: load data → build the route context → compose
 * `<head>`/body → assemble the document (template fill or in-code shell) → write.
 * Uses the configured shell `template` when supplied, otherwise the in-code shell.
 *
 * @param ctx - Plugin context (provides `require`, `state`, `config`, `has`).
 * @param instance - The concrete page instance to render.
 * @param shell - Per-build wiring shared across instances (asset tags + template).
 * @returns The instance's URL, rendered HTML, loaded data, and client-nav flag.
 * @example
 * ```ts
 * await renderInstance(ctx, instance, { assets: "", template: null });
 * ```
 */
async function renderInstance(
  ctx: Pick<PhaseContext, "require" | "state" | "config" | "has">,
  instance: PageInstance,
  shell: RenderShell
): Promise<RenderedPage> {
  const { definition, entry, params, locale } = instance;
  const router = ctx.require(routerPlugin);

  // Load build-only data and assemble the route context the handlers receive.
  const data = await loadRouteData(definition, params, locale, ctx);
  const url = entry.toUrl(params);
  const routeContext: RouteContext<RouteState> = {
    params,
    data,
    locale,
    // eslint-disable-next-line jsdoc/require-jsdoc -- inline link builder; delegates to router.toUrl
    url: (routeName, routeParams = {}) => router.toUrl(routeName, routeParams)
  };

  // Compose the page's head and body into the document parts.
  const parts: DocumentParts = {
    head: composeHeadHtml(ctx, instance, url, routeContext, data),
    body: renderBody(definition, routeContext),
    assets: shell.assets,
    locale
  };

  // Assemble the full document — shell template when configured, else the in-code shell.
  const html =
    shell.template === null ? renderDocument(parts) : fillTemplate(shell.template, parts);

  // Persist the document. A route with a `.render()` is client-navigable and so always
  // gets a data sidecar (see writeDataSidecars).
  await writeDocument(ctx.config.outDir, entry, params, html);
  return { url, html, data, clientNavigable: definition._handlers.render !== undefined };
}

// ── Phase orchestration (manifest → all pages → data sidecars → root capture) ────

/**
 * Prepare the per-build {@link RenderShell} ONCE (O(1) per page): read the optional
 * shell `template` from disk when configured + present, and precompute the injected
 * asset tags. `template` is `null` when unset/missing (use the in-code shell).
 *
 * @param ctx - Plugin context (provides `config`, `state`).
 * @returns The shared shell wiring (asset tags + template-or-null) for every page.
 * @example
 * ```ts
 * const shell = await prepareShell(ctx);
 * ```
 */
async function prepareShell(ctx: Pick<PhaseContext, "state" | "config">): Promise<RenderShell> {
  const templatePath = ctx.config.template;
  const template =
    typeof templatePath === "string" && existsSync(templatePath)
      ? await readFile(templatePath, "utf8")
      : // eslint-disable-next-line unicorn/no-null -- `null` = use the in-code shell
        null;
  return { assets: buildAssetTags(ctx), template };
}

/**
 * Expand every manifest route into its concrete page instances across all locales
 * (delegating per-route expansion to {@link expandRoute}) and flatten the result.
 *
 * @param manifest - The route definitions from `router.manifest()`.
 * @param locales - Active locale codes from i18n.
 * @param byPattern - Pattern→compiled-`TypedRoute` map (see {@link makeEntryMap}).
 * @param ctx - Plugin context (provides `require`/`has` for generate contexts).
 * @returns The flattened list of page instances to render.
 * @example
 * ```ts
 * const instances = await expandAllInstances(manifest, ["en"], byPattern, ctx);
 * ```
 */
async function expandAllInstances(
  manifest: readonly RouteDefinition[],
  locales: readonly string[],
  byPattern: Map<string, TypedRoute>,
  ctx: Pick<PhaseContext, "require" | "has">
): Promise<PageInstance[]> {
  const lists = await Promise.all(
    manifest.map(definition => expandRoute(definition, locales, byPattern, ctx))
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
 * Renders every route in the manifest to `outDir/<path>/index.html`. Reads as a
 * pipeline: resolve deps → prepare the shared shell → expand instances → render all
 * concurrently (`Promise.all`, legal intra-plugin concurrency) → write data sidecars
 * (hybrid/spa) → capture the root page's HTML for the root-index phase.
 *
 * @param ctx - Plugin context (provides `require`, `state`, `config`, `log`, `has`).
 * @returns The number of pages rendered and the captured default-page HTML.
 * @example
 * ```ts
 * const { pageCount, rootHtml } = await renderPages(ctx);
 * ```
 */
export async function renderPages(
  ctx: Pick<PhaseContext, "require" | "state" | "config" | "log" | "has">
): Promise<PagesResult> {
  // Resolve dependencies + snapshot the manifest into state for later phases.
  const router = ctx.require(routerPlugin);
  const manifest = router.manifest();
  ctx.state.manifest = [...manifest];
  const locales = ctx.require(i18nPlugin).locales();
  const byPattern = makeEntryMap(router);

  // Expand → render every page instance (shell read + asset tags computed once).
  const shell = await prepareShell(ctx);
  const instances = await expandAllInstances(manifest, locales, byPattern, ctx);
  const rendered = await Promise.all(
    instances.map(instance => renderInstance(ctx, instance, shell))
  );

  // Persist client-data sidecars (hybrid/spa) + capture the root page for root-index.
  await writeDataSidecars(ctx, rendered, router.mode());
  ctx.log.debug("build:pages", { count: rendered.length });
  return { pageCount: rendered.length, rootHtml: findRootHtml(rendered) };
}
