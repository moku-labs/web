/**
 * @file build phase 3 — pages. Pulls `router.manifest()` + `head.render(route, data)`
 * and SSR-renders each route to static HTML (preact-render-to-string). Appends the
 * build-id meta tag after `head.render()` returns. Does NOT compose `<head>` itself.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
 * Expand one route definition into its concrete page instances across all
 * locales, using `generate?.(locale)` when present (else a single empty-params
 * instance per locale).
 *
 * @param definition - The route definition from the manifest.
 * @param locales - Active locale codes from i18n.
 * @returns The flattened list of page instances for this route.
 * @example
 * ```ts
 * await expandRoute(def, ["en"]);
 * ```
 */
async function expandRoute(
  definition: RouteDefinition,
  locales: readonly string[],
  byPattern: Map<string, TypedRoute>,
  ctx: Pick<PhaseContext, "require" | "has">
): Promise<PageInstance[]> {
  const entry = byPattern.get(definition.pattern);
  if (!entry) {
    throw new Error(
      `[web] build.pages: no router entry for pattern "${definition.pattern}" — ` +
        "router.manifest() and router.entries() are out of sync."
    );
  }
  const { name } = entry;
  const instances: PageInstance[] = [];
  for (const locale of locales) {
    const generateContext: GenerateContext = { locale, require: ctx.require, has: ctx.has };
    const generated = definition._handlers.generate
      ? await definition._handlers.generate(generateContext)
      : [{}];
    for (const raw of generated) {
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

/**
 * Render one page instance to its static HTML document and write it to disk. Uses
 * the configured shell `template` (filled at build time) when supplied, otherwise
 * the in-code shell; injects the precomputed asset tags + build-id meta.
 *
 * @param ctx - Plugin context (provides `require`, `state`, `config`).
 * @param instance - The concrete page instance to render.
 * @param shell - Wiring shared across instances (asset tags + optional template).
 * @param shell.assets - The injected asset `<link>`/`<script>` tags.
 * @param shell.template - The shell template HTML, or `null` for the in-code shell.
 * @returns The instance's URL and rendered HTML (HTML reused for the root page).
 * @example
 * ```ts
 * await renderInstance(ctx, instance, { assets: "", template: null });
 * ```
 */
async function renderInstance(
  ctx: Pick<PhaseContext, "require" | "state" | "config" | "has">,
  instance: PageInstance,
  shell: { assets: string; template: string | null }
): Promise<{ url: string; html: string; data: unknown; clientNavigable: boolean }> {
  const { definition, entry, params, locale, name } = instance;
  // A route is client-navigable when it has a `render` handler (the build re-runs it
  // on client navigation). Such routes ALWAYS get a data sidecar — `{}` when there is
  // no `.load()` — so hybrid data-nav resolves cleanly instead of falling back to a
  // full HTML fetch. The loader receives a LoadContext (params + locale + require/has),
  // so it pulls sibling plugin APIs the spec way (`ctx.require(contentPlugin)`) with no
  // module global. Loaders run build-only, never on the client.
  const router = ctx.require(routerPlugin);
  const clientNavigable = definition._handlers.render !== undefined;
  const loadContext: LoadContext<RouteState> = {
    params,
    locale,
    require: ctx.require,
    has: ctx.has
  };
  const data = definition._handlers.load ? await definition._handlers.load(loadContext) : {};
  const routeContext: RouteContext<RouteState> = {
    params,
    data,
    locale,
    url: (routeName, routeParams = {}) => router.toUrl(routeName, routeParams)
  };
  const headConfig: HeadConfig | undefined = definition._handlers.head?.(routeContext);
  const url = entry.toUrl(params);
  const resolved: ResolvedRoute = { path: url, name, params, locale };
  if (headConfig) {
    resolved.head = adaptHeadConfig(headConfig);
  }
  const headHtml = ctx.require(headPlugin).render(resolved, data);
  const buildIdMeta = `<meta name="build-id" content="${ctx.state.runId ?? ""}">`;
  const vnode = definition._handlers.render?.(routeContext);
  // Apply the route's layout wrapper (persistent chrome) around the page VNode.
  // SSG-only: the client (spa) keeps the chrome and swaps just the inner region,
  // so the layout is NOT re-applied on navigation. The layout reads `.meta()` (e.g.
  // activeTab) and `locale` via its LayoutContext.
  const layoutCtx: LayoutContext<RouteState> = { ...routeContext, meta: definition._meta };
  const page =
    vnode && definition._handlers.layout ? definition._handlers.layout(layoutCtx, vnode) : vnode;
  const bodyHtml = page ? renderToString(page) : "";
  const parts: DocumentParts = {
    head: `${headHtml}${buildIdMeta}`,
    body: bodyHtml,
    assets: shell.assets,
    locale
  };
  const html =
    shell.template === null ? renderDocument(parts) : fillTemplate(shell.template, parts);
  const filePath = join(ctx.config.outDir, entry.toFile(params));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, html, "utf8");
  return { url, html, data, clientNavigable };
}

/**
 * Renders every route in the manifest to `outDir/<path>/index.html`. For each
 * route: expands instances via `route.generate?.(locale)`, loads data via
 * `route.load?.()`, pulls the composed `<head>` via `head.render(route, data)`,
 * renders the body, injects the build-id meta tag, and writes the file. Captures
 * the default (root `/`) page's HTML for the root-index phase. Renders all
 * instances concurrently via `Promise.all` (legal intra-plugin concurrency).
 *
 * @param ctx - Plugin context (provides `require`, `state`, `config`, `log`).
 * @returns The number of pages rendered and the captured default-page HTML.
 * @example
 * ```ts
 * const { pageCount, rootHtml } = await renderPages(ctx);
 * ```
 */
export async function renderPages(
  ctx: Pick<PhaseContext, "require" | "state" | "config" | "log" | "has">
): Promise<PagesResult> {
  const router = ctx.require(routerPlugin);
  const manifest = router.manifest();
  ctx.state.manifest = [...manifest];
  const mode = router.mode();
  const byPattern = makeEntryMap(router);
  const locales = ctx.require(i18nPlugin).locales();
  // Read the shell template ONCE and compute asset tags ONCE (O(1) per page).
  const templatePath = ctx.config.template;
  const template =
    typeof templatePath === "string" && existsSync(templatePath)
      ? await readFile(templatePath, "utf8")
      : // eslint-disable-next-line unicorn/no-null -- `null` = use the in-code shell
        null;
  const assets = buildAssetTags(ctx);
  const shell = { assets, template };
  const instanceLists = await Promise.all(
    manifest.map(definition => expandRoute(definition, locales, byPattern, ctx))
  );
  const instances = instanceLists.flat();
  const rendered = await Promise.all(
    instances.map(instance => renderInstance(ctx, instance, shell))
  );
  // Persist per-page client data when the app opts into hybrid/spa navigation.
  // ONE expansion (above) feeds both the HTML and the data sidecars — no duplication.
  if (mode !== "ssg" && ctx.has("data")) {
    const entries: DataEntry[] = rendered
      .filter(page => page.clientNavigable)
      .map(page => ({ path: page.url, data: page.data }));
    if (entries.length > 0) {
      const summary = await ctx.require(dataPlugin).write(entries, { outDir: ctx.config.outDir });
      ctx.log.debug("build:data", { files: summary.fileCount, bytes: summary.bytes });
    }
  }
  const root = rendered.find(page => page.url === "/" || page.url === "");
  ctx.log.debug("build:pages", { count: rendered.length });
  return { pageCount: rendered.length, rootHtml: root?.html ?? null };
}
