/**
 * @file build phase — locale-redirects. For each non-prefixed route path, emits a
 * redirect HTML page (`<meta http-equiv="refresh">` + canonical `<link>`) at the
 * bare path that points at the default-locale-prefixed URL. Deliberately does NOT
 * emit a Cloudflare `_redirects` catch-all (an SSG infinite-loop trap). Gated by
 * `config.localeRedirects` (false/unset disables).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { i18nPlugin } from "../../i18n";
import { routerPlugin } from "../../router";
import type { GenerateContext, RouteDefinition, TypedRoute } from "../../router/types";
import type { PhaseContext } from "../types";

/** Result of the locale-redirects phase — the number of redirect pages written. */
export type LocaleRedirectsResult = {
  /** Count of bare-path redirect HTML pages emitted. */
  written: number;
};

/** Minimal router API slice the phase consumes (`manifest()` + `entries()`). */
type RouterSlice = {
  /** The route definitions in manifest order. */
  manifest(): readonly RouteDefinition[];
  /** The compiled route entries (own `toUrl`/`toFile`). */
  entries(): readonly TypedRoute[];
};

/**
 * Render a redirect HTML page: a `0;url` refresh meta + a canonical link to `target`.
 *
 * @param target - The default-locale-prefixed URL to redirect to.
 * @returns The complete redirect HTML document string.
 * @example
 * ```ts
 * redirectHtml("/en/about/");
 * ```
 */
function redirectHtml(target: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta http-equiv="refresh" content="0;url=${target}">` +
    `<link rel="canonical" href="${target}"></head>` +
    `<body><a href="${target}">Redirecting…</a></body></html>`
  );
}

/**
 * Correlate manifest definitions to compiled `TypedRoute` entries by pattern (the
 * shared stable key); routes without a compiled entry are skipped.
 *
 * @param router - The router API exposing `manifest` + `entries`.
 * @returns Pairs of `[definition, entry]` for every correlated route.
 * @example
 * ```ts
 * pairRoutes(router);
 * ```
 */
function pairRoutes(router: RouterSlice): Array<[RouteDefinition, TypedRoute]> {
  const byPattern = new Map<string, TypedRoute>();
  for (const entry of router.entries()) byPattern.set(entry.pattern, entry);
  const pairs: Array<[RouteDefinition, TypedRoute]> = [];
  for (const definition of router.manifest()) {
    const entry = byPattern.get(definition.pattern);
    if (entry) pairs.push([definition, entry]);
  }
  return pairs;
}

/**
 * Compute the single bare→default redirect job for one generated parameter set, or
 * `null` when no redirect is needed. The BARE (locale-less) path is derived by
 * stripping `lang`. `generate()` supplies `lang` (pages need it), so using `params`
 * as-is makes the "bare" URL already carry the locale → target === bareUrl → NO
 * redirect is ever emitted. Removing `lang` yields the real lang-less file/URL
 * (`/`, `/about/`, `/{slug}/`) that must redirect to the default-locale URL.
 *
 * @param entry - The compiled `TypedRoute` (owns `toFile`/`toUrl`).
 * @param raw - One raw parameter set from `generate()` (may be `null`/`undefined`).
 * @param defaultLocale - The default locale to redirect bare paths to.
 * @returns The `{ file, target }` redirect job, or `null` when no redirect is needed.
 * @example
 * ```ts
 * redirectJobFor(entry, { lang: "en", slug: "hello" }, "en");
 * ```
 */
function redirectJobFor(
  entry: TypedRoute,
  raw: unknown,
  defaultLocale: string
): { file: string; target: string } | null {
  // Strip `lang` to recover the locale-less bare path/URL this redirect lives at.
  const params = (raw ?? {}) as Record<string, string>;
  const bareParams = { ...params };
  delete bareParams.lang;

  // Resolve the bare output file, the default-locale target, and the bare URL.
  const file = entry.toFile(bareParams);
  const target = entry.toUrl({ ...bareParams, lang: defaultLocale });
  const bareUrl = entry.toUrl(bareParams);

  // A redirect is only needed when the route is locale-prefixed (bare URL differs).
  const isLocalePrefixed = target !== bareUrl;
  if (!isLocalePrefixed) {
    // eslint-disable-next-line unicorn/no-null -- `null` signals "no redirect needed"
    return null;
  }
  return { file, target };
}

/**
 * Expand one route into bare→default redirect jobs for the default locale. Uses
 * `generate?.(defaultLocale)` (or a single empty-params instance) and emits a job
 * only when the bare file path differs from the default-locale URL (i.e. the route
 * is locale-prefixed) — otherwise no redirect is needed.
 *
 * @param definition - The route definition (carries `generate`).
 * @param entry - The compiled `TypedRoute` (owns `toFile`/`toUrl`).
 * @param defaultLocale - The default locale to redirect bare paths to.
 * @param ctx - Phase context slice (`require`/`has`) forwarded into the `generate()` ctx.
 * @returns Redirect jobs of `{ file, target }` for this route.
 * @example
 * ```ts
 * await expandRedirects(def, entry, "en", ctx);
 * ```
 */
async function expandRedirects(
  definition: RouteDefinition,
  entry: TypedRoute,
  defaultLocale: string,
  ctx: Pick<PhaseContext, "require" | "has">
): Promise<Array<{ file: string; target: string }>> {
  // Build the ctx forwarded into `generate()` for the default-locale pass.
  const generateContext: GenerateContext = {
    locale: defaultLocale,
    require: ctx.require,
    has: ctx.has
  };

  // Fetch the parameter sets to expand (or a single empty-params instance).
  const parameterSets = definition._handlers.generate
    ? await definition._handlers.generate(generateContext)
    : [{}];

  // Compute one redirect job per parameter set, dropping the no-redirect cases.
  const jobs: Array<{ file: string; target: string }> = [];
  for (const raw of parameterSets) {
    const job = redirectJobFor(entry, raw, defaultLocale);
    if (job) jobs.push(job);
  }
  return jobs;
}

/**
 * Write a single bare-path redirect page into `outDir`, creating its parent
 * directory tree as needed (the bare path may be nested, e.g. `about/index.html`).
 *
 * @param job - The redirect job (`file` relative path + `target` URL).
 * @param job.file - The redirect page's output path, relative to `outDir`.
 * @param job.target - The absolute default-locale URL the page redirects to.
 * @param outDir - The build output directory the file is resolved against.
 * @returns Resolves once the redirect HTML page is written.
 * @example
 * ```ts
 * await writeRedirectFile({ file: "about/index.html", target: "/en/about/" }, "dist");
 * ```
 */
async function writeRedirectFile(
  job: { file: string; target: string },
  outDir: string
): Promise<void> {
  const filePath = path.join(outDir, job.file);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, redirectHtml(job.target), "utf8");
}

/**
 * Emits one bare-path redirect HTML page per locale-prefixed route path, each a
 * `0;url` refresh + canonical link to the default-locale URL. Never writes a
 * Cloudflare `_redirects` file. No-op (returns `null`) when `localeRedirects` is
 * false/unset.
 *
 * @param ctx - Plugin context (provides `require`, `config`, `log`).
 * @returns The count of redirect pages written, or `null` when disabled.
 * @example
 * ```ts
 * const result = await generateLocaleRedirects(ctx);
 * ```
 */
export async function generateLocaleRedirects(
  ctx: Pick<PhaseContext, "require" | "config" | "log" | "has">
): Promise<LocaleRedirectsResult | null> {
  // Locale redirects are opt-in — a disabled build skips the phase entirely.
  if (!ctx.config.localeRedirects) {
    ctx.log.debug("build:locale-redirects", { skipped: true });
    // eslint-disable-next-line unicorn/no-null -- `null` signals a disabled phase
    return null;
  }

  // Gather the inputs: the router (manifest + entries) and the default locale.
  const router = ctx.require(routerPlugin);
  const defaultLocale = ctx.require(i18nPlugin).defaultLocale();

  // Expand every correlated route into its bare→default redirect jobs.
  const jobLists = await Promise.all(
    pairRoutes(router).map(([definition, entry]) =>
      expandRedirects(definition, entry, defaultLocale, ctx)
    )
  );
  const jobs = jobLists.flat();

  // Persist one redirect HTML page per job into outDir.
  await Promise.all(jobs.map(job => writeRedirectFile(job, ctx.config.outDir)));

  ctx.log.debug("build:locale-redirects", { written: jobs.length });
  return { written: jobs.length };
}
