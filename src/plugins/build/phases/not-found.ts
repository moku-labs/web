/**
 * @file build phase — not-found. Emits `outDir/404.html` from configured route
 * content or a built-in default. Gated by `config.notFound` (false/unset disables).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PhaseContext } from "../types";

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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>404 — Not Found</title></head><body>${body}</body></html>`;
}

/**
 * Emits `outDir/404.html`. When `config.notFound` is `true`, writes the built-in
 * default page; when it is `{ body }`, writes the supplied HTML body content
 * verbatim inside the document shell. No-op (returns `null`) when `notFound` is
 * false/unset.
 *
 * @param ctx - Plugin context (provides `config`, `log`).
 * @returns The written file path, or `null` when disabled.
 * @example
 * ```ts
 * const result = await generateNotFound(ctx);
 * ```
 */
export async function generateNotFound(
  ctx: Pick<PhaseContext, "config" | "log">
): Promise<NotFoundResult | null> {
  const { notFound, outDir } = ctx.config;
  if (!notFound) {
    ctx.log.debug("build:not-found", { skipped: true });
    // eslint-disable-next-line unicorn/no-null -- `null` signals a disabled phase
    return null;
  }
  const body = typeof notFound === "object" && notFound.body ? notFound.body : DEFAULT_BODY;
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, "404.html");
  await writeFile(file, wrap(body), "utf8");
  ctx.log.debug("build:not-found", { path: file });
  return { path: file };
}
