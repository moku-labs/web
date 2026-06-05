/**
 * @file cli plugin — static preview server for the built `dist/`. Exposes a PURE,
 * server-agnostic clean-URL resolver (`resolveCleanUrl`) — unit-tested without a
 * socket — plus `runPreviewServer`, which serves the resolved files via `Bun.serve`
 * the way Cloudflare Pages does (trailing slash → `index.html`, extensionless →
 * `<path>/index.html`, a miss → the nearest `404.html`). No reload injection.
 */
import { statSync } from "node:fs";
import path from "node:path";
import type { CliPluginContext } from "./api";
import { installSignalTeardown } from "./serve";

/**
 * A predicate that reports whether an absolute path is an existing regular file.
 * Injected so the resolver can be unit-tested against a virtual file set.
 *
 * @example
 * const exists: FileProbe = path => realPaths.has(path);
 */
export type FileProbe = (path: string) => boolean;

/**
 * The outcome of resolving a request pathname against `dist/`: the on-disk file to
 * serve plus the HTTP status (`200` for a hit, `404` for a not-found fallback). A
 * `null` file means nothing matched at all (not even a `404.html`).
 *
 * @example
 * const resolved: ResolvedFile = { file: "/dist/index.html", status: 200 };
 */
export type ResolvedFile = {
  /** The absolute on-disk path to serve, or `null` when nothing matched. */
  file: string | null;
  /** The HTTP status to respond with (`200` hit, `404` fallback/miss). */
  status: 200 | 404;
};

/**
 * Strip leading `../` segments (after `normalize`) so a request can never escape the
 * served root via path traversal.
 *
 * @param pathname - The decoded request pathname.
 * @returns The traversal-safe relative path.
 * @example
 * safePath("../../etc/passwd"); // "etc/passwd"
 */
export function safePath(pathname: string): string {
  return path.normalize(pathname).replace(/^(\.\.(?:[/\\]|$))+/, "");
}

/**
 * The default {@link FileProbe} backed by `node:fs.statSync` — a single stat (no
 * exists+stat race) that swallows the ENOENT thrown for a missing path.
 *
 * @param filePath - Candidate on-disk path.
 * @returns Whether it resolves to a regular file.
 * @example
 * statIsFile("/dist/index.html");
 */
export function statIsFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a request pathname to a real file under `rootDir`, mirroring Cloudflare
 * Pages clean URLs. Pure and server-agnostic: it touches the filesystem only through
 * the injected {@link FileProbe}, so it is unit-tested without a server. A trailing
 * slash maps to `index.html`; an extensionless path tries the file then
 * `<path>/index.html`; a miss climbs toward the root for the nearest `404.html`
 * (served with status `404`).
 *
 * @param rootDir - The absolute (or cwd-relative) build output directory.
 * @param pathname - The decoded request pathname (always starts with `/`).
 * @param isFile - File-existence probe (defaults to {@link statIsFile}).
 * @returns The resolved file + status (file `null` when not even a `404.html` exists).
 * @example
 * resolveCleanUrl("dist", "/about/", path => set.has(path));
 */
export function resolveCleanUrl(
  rootDir: string,
  pathname: string,
  isFile: FileProbe = statIsFile
): ResolvedFile {
  // Serve the direct match first: a clean URL maps to a file or its index.html.
  const relative = safePath(pathname);
  const base = path.join(rootDir, relative);
  const candidates = pathname.endsWith("/")
    ? [path.join(base, "index.html")]
    : [base, path.join(base, "index.html")];
  for (const candidate of candidates) {
    if (isFile(candidate)) return { file: candidate, status: 200 };
  }

  // No file matched — climb from the deepest directory toward the root for a 404.html.
  const segments = path.join(rootDir, relative).split(path.sep).filter(Boolean);
  for (let depth = segments.length; depth >= 1; depth--) {
    const candidate = path.join(segments.slice(0, depth).join(path.sep), "404.html");
    if (isFile(candidate)) return { file: candidate, status: 404 };
  }

  // Fall back to the root 404.html; a null file signals not even that exists.
  const root = path.join(rootDir, "404.html");
  // eslint-disable-next-line unicorn/no-null -- contract: file is null when nothing (not even a 404) matched.
  return isFile(root) ? { file: root, status: 404 } : { file: null, status: 404 };
}

/**
 * Build the request handler for the preview server: resolves each request via
 * {@link resolveCleanUrl} and serves the file (no reload injection, mirroring prod).
 *
 * @param ctx - The cli plugin context (provides `config` + `state.fileResponse`).
 * @returns The `fetch` handler passed to the static server.
 * @example
 * const handler = createPreviewHandler(ctx);
 */
export function createPreviewHandler(ctx: CliPluginContext): (request: Request) => Response {
  return request => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const resolved = resolveCleanUrl(ctx.config.outDir, pathname);
    if (resolved.file === null) return new Response("Not Found", { status: 404 });
    return ctx.state.fileResponse(resolved.file, resolved.status);
  };
}

/**
 * Run the static preview server for the built `dist/`. Serves files resolved by
 * {@link resolveCleanUrl} via the injectable static-server seam — with no live-reload
 * injection, mirroring production. Renders the server-ready panel and resolves on
 * SIGINT/SIGTERM.
 *
 * @param ctx - The cli plugin context (provides `config` + `state` seams).
 * @param port - The port to bind to.
 * @returns Resolves once the server has been torn down by a termination signal.
 * @example
 * await runPreviewServer(ctx, 4173);
 */
export function runPreviewServer(ctx: CliPluginContext, port: number): Promise<void> {
  const server = ctx.state.serveStatic({ port, fetch: createPreviewHandler(ctx) });
  ctx.state.render.serverReady({
    local: `http://localhost:${port}`,
    network: ctx.state.networkUrl(port)
  });
  return installSignalTeardown(() => server.stop());
}
