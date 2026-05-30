/**
 * @file build phase 3 — pages. Pulls `router.manifest()` + `head.render(route, data)`
 * and SSR-renders each route to static HTML (preact-render-to-string). Appends the
 * build-id meta tag after `head.render()` returns. Does NOT compose `<head>` itself.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { renderToString } from "preact-render-to-string";
import { headPlugin } from "../../head";
import type {
  HeadConfig as ComposedHeadConfig,
  HeadElement,
  ResolvedRoute
} from "../../head/types";
import { i18nPlugin } from "../../i18n";
import { routerPlugin } from "../../router";
import type {
  HeadConfig,
  RouteContext,
  RouteDefinition,
  RouteState,
  TypedRoute
} from "../../router/types";
import type { PhaseContext } from "../types";

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

/**
 * Compose the full static HTML document, injecting the build-id meta tag into
 * `<head>` AFTER the head plugin's composed HTML (build metadata, not content).
 *
 * @param headHtml - The composed `<head>` inner HTML from `head.render`.
 * @param bodyHtml - The SSR-rendered body HTML.
 * @param runId - The per-run build id injected as `<meta name="build-id">`.
 * @param locale - The page locale for the `<html lang>` attribute.
 * @returns The complete HTML document string.
 * @example
 * ```ts
 * renderDocument("<title>Hi</title>", "<h1>Hi</h1>", "run-1", "en");
 * ```
 */
function renderDocument(headHtml: string, bodyHtml: string, runId: string, locale: string): string {
  const buildIdMeta = `<meta name="build-id" content="${runId}">`;
  return `<!DOCTYPE html><html lang="${locale}"><head>${headHtml}${buildIdMeta}</head><body>${bodyHtml}</body></html>`;
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
  byPattern: Map<string, TypedRoute>
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
    const generated = definition._handlers.generate
      ? await definition._handlers.generate(locale)
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
 * Render one page instance to its static HTML document and write it to disk.
 *
 * @param ctx - Plugin context (provides `require`, `state`, `config`).
 * @param instance - The concrete page instance to render.
 * @returns The instance's URL and rendered HTML (HTML reused for the root page).
 * @example
 * ```ts
 * await renderInstance(ctx, instance);
 * ```
 */
async function renderInstance(
  ctx: Pick<PhaseContext, "require" | "state" | "config">,
  instance: PageInstance
): Promise<{ url: string; html: string }> {
  const { definition, entry, params, locale, name } = instance;
  const data = definition._handlers.load
    ? await definition._handlers.load(params, locale)
    : undefined;
  const routeContext: RouteContext<RouteState> = { params, data, locale };
  const headConfig: HeadConfig | undefined = definition._handlers.head?.(routeContext);
  const url = entry.toUrl(params);
  const resolved: ResolvedRoute = { path: url, name, params, locale };
  if (headConfig) {
    resolved.head = adaptHeadConfig(headConfig);
  }
  const headHtml = ctx.require(headPlugin).render(resolved, data);
  const vnode = definition._handlers.render?.(routeContext);
  const bodyHtml = vnode ? renderToString(vnode) : "";
  const html = renderDocument(headHtml, bodyHtml, ctx.state.runId ?? "", locale);
  const filePath = join(ctx.config.outDir, entry.toFile(params));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, html, "utf8");
  return { url, html };
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
  ctx: Pick<PhaseContext, "require" | "state" | "config" | "log">
): Promise<PagesResult> {
  const router = ctx.require(routerPlugin);
  const manifest = router.manifest();
  ctx.state.manifest = [...manifest];
  const byPattern = makeEntryMap(router);
  const locales = ctx.require(i18nPlugin).locales();
  const instanceLists = await Promise.all(
    manifest.map(definition => expandRoute(definition, locales, byPattern))
  );
  const instances = instanceLists.flat();
  const rendered = await Promise.all(instances.map(instance => renderInstance(ctx, instance)));
  const root = rendered.find(page => page.url === "/" || page.url === "");
  ctx.log.debug("build:pages", { count: rendered.length });
  return { pageCount: rendered.length, rootHtml: root?.html ?? null };
}
