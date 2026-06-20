/**
 * @file build phase — locale-redirects. For each REQUIRED-`{lang}` route (whose bare,
 * locale-less path would otherwise 404 — pages writes only `/{locale}/…`), emits a
 * redirect HTML page (`<meta http-equiv="refresh">` + canonical `<link>`) at the
 * bare path that points at the default-locale-prefixed URL. OPTIONAL-`{lang:?}`
 * routes get NO redirect: the default locale is served BARE, so the pages phase
 * already writes the real content page at the bare path (plus a `/{defaultLocale}/…`
 * alias) — a redirect there would overwrite content. Deliberately does NOT emit a
 * Cloudflare `_redirects` catch-all (an SSG infinite-loop trap). Gated by
 * `config.localeRedirects` (false/unset disables).
 *
 * When `head.defaultOgImage` is configured, each redirect page ALSO carries the
 * site-level Open Graph / Twitter block (`head.siteHead`) so a social crawler that
 * fetches the apex domain (or any locale-less alias) — and does not follow the
 * meta-refresh — still gets a branded preview card. No image configured ⇒ bare redirect.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { headPlugin } from "../../head";
import { fallbackI18n, i18nPlugin } from "../../i18n";
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
 * Render a redirect HTML page: a `0;url` refresh meta + a canonical link to `target`,
 * with an optional site-level OG/Twitter block injected at the end of `<head>`.
 *
 * @param target - The default-locale-prefixed URL to redirect to.
 * @param headExtra - Extra `<head>` inner HTML (the site-level OG block), or `""` for none.
 * @returns The complete redirect HTML document string.
 * @example
 * ```ts
 * redirectHtml("/en/about/", '<meta property="og:image" content="…">');
 * ```
 */
function redirectHtml(target: string, headExtra = ""): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta http-equiv="refresh" content="0;url=${target}">` +
    `<link rel="canonical" href="${target}">${headExtra}</head>` +
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
 * Only a REQUIRED-`{lang}` route produces a job. On an OPTIONAL-`{lang:?}` route the
 * compiled `toUrl` serves the default locale BARE (`toUrl({ lang: defaultLocale })`
 * equals the bare URL), so `target === bareUrl` → `null`. That is by design AND the
 * collision guard: the pages phase writes the default-locale content page at exactly
 * that bare file, and a redirect would overwrite it.
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

  // A redirect is only needed when the default-locale URL differs from the bare URL —
  // true only for REQUIRED `{lang}` routes. Optional `{lang:?}` routes serve the default
  // locale bare (target === bareUrl), so they are skipped and the bare content page
  // written by the pages phase is never clobbered.
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
 * @param headExtra - The site-level OG block to inject into `<head>`, or `""` for none.
 * @returns Resolves once the redirect HTML page is written.
 * @example
 * ```ts
 * await writeRedirectFile({ file: "about/index.html", target: "/en/about/" }, "dist", "");
 * ```
 */
async function writeRedirectFile(
  job: { file: string; target: string },
  outDir: string,
  headExtra = ""
): Promise<void> {
  const filePath = path.join(outDir, job.file);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, redirectHtml(job.target, headExtra), "utf8");
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
  // i18n is OPTIONAL — single default-locale fallback when not composed.
  const router = ctx.require(routerPlugin);
  const i18n = ctx.has("i18n") ? ctx.require(i18nPlugin) : fallbackI18n;
  const defaultLocale = i18n.defaultLocale();

  // Expand every correlated route into its bare→default redirect jobs.
  const jobLists = await Promise.all(
    pairRoutes(router).map(([definition, entry]) =>
      expandRedirects(definition, entry, defaultLocale, ctx)
    )
  );
  const jobs = jobLists.flat();

  // Resolve the head API once (a hard build dependency; guarded so phase-unit mocks that
  // omit it still produce bare redirects). `siteHead` returns "" unless a default OG image
  // is configured, so apps that opt out keep the exact bare redirect (no behavior change).
  const head = ctx.has("head") ? ctx.require(headPlugin) : undefined;

  // Persist one redirect HTML page per job into outDir, each carrying the site-level OG block.
  await Promise.all(
    jobs.map(job => {
      const headExtra = head ? head.siteHead({ url: job.target, locale: defaultLocale }) : "";
      return writeRedirectFile(job, ctx.config.outDir, headExtra);
    })
  );

  ctx.log.debug("build:locale-redirects", { written: jobs.length });
  return { written: jobs.length };
}
