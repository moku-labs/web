/**
 * @file build phase — not-found. Emits `outDir/404.html` from configured route
 * content or a built-in default, substituting the `<!--moku:assets-->` family of
 * placeholders (the bundles are fingerprint-named, so an app-owned 404 page can
 * no longer hardcode a bundle URL). Gated by `config.notFound` (false/unset
 * disables).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PhaseContext } from "../types";
import { substituteAssetPlaceholders } from "./asset-tags";

/** The built-in default 404 page body when no custom route content is supplied. */
const DEFAULT_BODY = "<h1>404</h1><p>The page you requested could not be found.</p>";

/**
 * Result of the not-found phase — the written 404 file path.
 *
 * @example
 * ```ts
 * const result: NotFoundResult = { path: "dist/404.html" };
 * ```
 */
export type NotFoundResult = {
  /** The absolute/relative on-disk path of the written `404.html`. */
  path: string;
};

/**
 * Wrap a body fragment in a minimal HTML document for the 404 page.
 *
 * @param body - The inner body HTML (default or configured).
 * @returns The complete HTML document string.
 * @example
 * ```ts
 * wrap("<h1>404</h1>");
 * ```
 */
function wrap(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>404 — Not Found</title></head><body>${body}</body></html>`;
}

/**
 * Resolve the 404 page HTML from `config.notFound`. Precedence: `path` (a
 * complete page file, read verbatim) > `body` (a fragment, wrapped in the
 * minimal shell) > the built-in default.
 *
 * @param notFound - The `config.notFound` value (already known to be truthy).
 * @returns The complete HTML document to write.
 * @example
 * ```ts
 * const html = await resolveHtml({ path: "src/404.html" });
 * ```
 */
async function resolveHtml(notFound: true | { body?: string; path?: string }): Promise<string> {
  // `{ path }` — the app owns a complete document; emit it byte-for-byte.
  if (typeof notFound === "object" && notFound.path) {
    try {
      return await readFile(notFound.path, "utf8");
    } catch (error) {
      throw new Error(`build:not-found — could not read notFound.path "${notFound.path}"`, {
        cause: error
      });
    }
  }

  // `{ body }` fragment, or the built-in default — wrapped in the minimal shell.
  const body = typeof notFound === "object" && notFound.body ? notFound.body : DEFAULT_BODY;
  return wrap(body);
}

/**
 * Emits `outDir/404.html`. When `config.notFound` is `true`, writes the built-in
 * default page; `{ body }` writes the supplied HTML body content inside the
 * minimal document shell; `{ path }` writes the referenced HTML page file (the
 * app owns the whole document). In every variant the `<!--moku:assets-->` /
 * `<!--moku:assets:css-->` / `<!--moku:assets:js-->` placeholders are substituted
 * with the fingerprinted bundle tags — a page without placeholders passes through
 * byte-for-byte. No-op (returns `null`) when `notFound` is false/unset.
 *
 * @param ctx - Plugin context (provides `state`, `config`, `log`).
 * @returns The written file path, or `null` when disabled.
 * @example
 * ```ts
 * const result = await generateNotFound(ctx);
 * ```
 */
export async function generateNotFound(
  ctx: Pick<PhaseContext, "state" | "config" | "log">
): Promise<NotFoundResult | null> {
  const { notFound, outDir } = ctx.config;
  if (!notFound) {
    ctx.log.debug("build:not-found", { skipped: true });
    // eslint-disable-next-line unicorn/no-null -- `null` signals a disabled phase
    return null;
  }
  const html = substituteAssetPlaceholders(ctx, await resolveHtml(notFound));
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, "404.html");
  await writeFile(file, html, "utf8");
  ctx.log.debug("build:not-found", { path: file });
  return { path: file };
}
