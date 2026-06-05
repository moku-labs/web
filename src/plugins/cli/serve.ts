/**
 * @file cli plugin — the dev server (`serve()`): an initial build, an in-process
 * static server that injects a live-reload SSE client into HTML, a recursive watcher
 * over `config.watchDirs`, and a debounced rebuild that re-renders and pushes a
 * browser reload. Lifted from the blog `scripts/dev.ts` + `scripts/serve.ts`. The
 * server/watch/clock are all behind injectable state seams so nothing real runs in
 * tests; SIGINT/SIGTERM tear everything down and resolve the returned promise.
 */
import { buildPlugin } from "../build";
import type { CliPluginContext } from "./api";
import { resolveCleanUrl } from "./preview";
import type { BuildSummary, ReloadInfo } from "./types";

/** SSE path the injected client connects to for reload notifications. */
export const RELOAD_PATH = "/__moku_reload";

/** The live-reload client snippet injected before `</body>` in served HTML. */
const RELOAD_CLIENT = `<script>(()=>{try{const s=new EventSource("${RELOAD_PATH}");s.addEventListener("reload",()=>location.reload());}catch{}})();</script>`;

/**
 * Inject the live-reload SSE client immediately before the closing `</body>` (or
 * append it when there is no `</body>`). Pure — unit-testable without a server.
 *
 * @param html - The page HTML to augment.
 * @returns The HTML with the reload client injected.
 * @example
 * injectReloadClient("<body>hi</body>"); // "<body>hi<script>…</script></body>"
 */
export function injectReloadClient(html: string): string {
  const marker = "</body>";
  const index = html.lastIndexOf(marker);
  return index === -1
    ? html + RELOAD_CLIENT
    : html.slice(0, index) + RELOAD_CLIENT + html.slice(index);
}

/**
 * A debounced rebuild driver: coalesces a burst of change notifications into a
 * single `runBuild()`, guards against overlapping runs, and reports the changed
 * label (the watched directory, in `serve()`) + fresh summary once the rebuild
 * settles.
 *
 * @example
 * const rebuilder = createRebuilder({ debounceMs: 150, runBuild, onReloaded, onError });
 * rebuilder.schedule("content");
 */
export type Rebuilder = {
  /**
   * Queue a rebuild for the given label (debounced + coalesced). `serve()` passes the
   * watched directory whose subtree changed (the watcher does not surface the per-file
   * path), so this is a directory rather than a single file.
   *
   * @param file - The label reported as `ReloadInfo.file` — the watched directory in `serve()`.
   * @returns Nothing.
   * @example
   * rebuilder.schedule("src");
   */
  schedule(file: string): void;
  /**
   * Cancel any pending (not-yet-fired) rebuild timer.
   *
   * @returns Nothing.
   * @example
   * rebuilder.cancel();
   */
  cancel(): void;
};

/**
 * Run one rebuild and report the result. Skips re-entrancy via the shared `building`
 * flag and routes success to `onReloaded`, failure to `onError`.
 *
 * @param input - The rebuild dependencies + the changed file.
 * @param input.runBuild - Runs one build and resolves with its summary.
 * @param input.onReloaded - Called with the changed file + summary after a rebuild.
 * @param input.onError - Called when a rebuild throws.
 * @param input.file - The changed file to report alongside the summary.
 * @returns Resolves once the rebuild settles (always — errors are routed, not thrown).
 * @example
 * await runOneRebuild({ runBuild, onReloaded, onError, file: "a.md" });
 */
async function runOneRebuild(input: {
  runBuild: () => Promise<BuildSummary>;
  onReloaded: (info: ReloadInfo) => void;
  onError: (error: unknown) => void;
  file: string;
}): Promise<void> {
  try {
    const summary = await input.runBuild();
    input.onReloaded({
      file: input.file,
      pageCount: summary.pageCount,
      durationMs: summary.durationMs
    });
  } catch (error) {
    input.onError(error);
  }
}

/**
 * Create a {@link Rebuilder}. The latest changed file within the debounce window
 * wins; only one build runs at a time, but a change arriving while a rebuild is in
 * flight is NOT lost — it sets a `dirty` flag and triggers exactly one coalesced
 * re-run once the current build settles (matching the blog `dev.ts`, minus its
 * dropped-change gap).
 *
 * @param input - The rebuild dependencies.
 * @param input.debounceMs - Debounce window in milliseconds.
 * @param input.runBuild - Runs one build and resolves with its summary.
 * @param input.onReloaded - Called with the changed file + summary after a rebuild.
 * @param input.onError - Called when a rebuild throws.
 * @returns The debounced rebuild driver.
 * @example
 * createRebuilder({ debounceMs: 150, runBuild, onReloaded, onError });
 */
export function createRebuilder(input: {
  debounceMs: number;
  runBuild: () => Promise<BuildSummary>;
  onReloaded: (info: ReloadInfo) => void;
  onError: (error: unknown) => void;
}): Rebuilder {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingFile = "";
  let building = false;
  let dirty = false;

  /**
   * Run the queued rebuild once, then — if a change arrived while it was in flight —
   * re-run exactly once more so no change is dropped. Marks `dirty` (instead of
   * running) when a rebuild is already underway, resetting the in-flight flag when
   * each run settles.
   *
   * @returns Resolves once the rebuild (and any coalesced re-run) settles (errors are
   *   routed, never thrown).
   * @example
   * await fire();
   */
  const fire = async (): Promise<void> => {
    timer = undefined;
    if (building) {
      dirty = true;
      return;
    }
    building = true;
    do {
      dirty = false;
      await runOneRebuild({
        runBuild: input.runBuild,
        onReloaded: input.onReloaded,
        onError: input.onError,
        file: pendingFile
      });
    } while (dirty);
    building = false;
  };

  return {
    /**
     * Queue a rebuild for the given label (debounced + coalesced).
     *
     * @param file - The label reported as `ReloadInfo.file` — the watched directory in `serve()`.
     * @example
     * rebuilder.schedule("content");
     */
    schedule(file) {
      pendingFile = file;
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, input.debounceMs);
    },
    /**
     * Cancel any pending (not-yet-fired) rebuild timer.
     *
     * @example
     * rebuilder.cancel();
     */
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    }
  };
}

/**
 * Install SIGINT/SIGTERM handlers that run `teardown()` and resolve the returned
 * promise, so a long-running command (`serve`/`preview`) unblocks its `await` on
 * Ctrl-C / termination and detaches its own listeners. Used by both servers.
 *
 * @param teardown - Cleanup to run on the first termination signal.
 * @returns A promise that resolves once a termination signal has been handled.
 * @example
 * await installSignalTeardown(() => server.stop());
 */
export function installSignalTeardown(teardown: () => void): Promise<void> {
  return new Promise<void>(resolve => {
    /**
     * Detach both signal listeners, run teardown, and resolve the wait (once).
     *
     * @example
     * onSignal();
     */
    const onSignal = (): void => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      teardown();
      resolve();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}

/**
 * A live-reload broadcaster over Server-Sent Events: tracks connected clients and
 * pushes a `reload` event to all of them after a rebuild.
 *
 * @example
 * const hub = createReloadHub();
 * const response = hub.connect();
 * hub.reloadAll();
 */
export type ReloadHub = {
  /**
   * Open one SSE connection and return its streaming `Response`.
   *
   * @returns A `text/event-stream` response wired to this hub.
   * @example
   * return hub.connect();
   */
  connect(): Response;
  /**
   * Push a `reload` event to every connected client.
   *
   * @returns Nothing.
   * @example
   * hub.reloadAll();
   */
  reloadAll(): void;
  /**
   * The number of currently-connected clients (introspection / tests).
   *
   * @returns The live client count.
   * @example
   * hub.size();
   */
  size(): number;
};

/** The SSE comment line sent on connect to open the stream. */
const SSE_OPEN = ": connected\n\n";
/** The SSE frame pushed to reload a connected browser. */
const SSE_RELOAD = "event: reload\ndata: 1\n\n";

/**
 * Create a {@link ReloadHub} backed by `ReadableStream` controllers. Each `connect()`
 * enqueues into a new stream; `reloadAll()` writes the reload frame to every live
 * controller (dropping any that have closed).
 *
 * @returns The reload hub.
 * @example
 * const hub = createReloadHub();
 */
export function createReloadHub(): ReloadHub {
  const encoder = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  return {
    /**
     * Open one SSE connection, register its controller, and return the streaming
     * `Response` (a connect comment is sent immediately to open the stream).
     *
     * @returns A `text/event-stream` response wired to this hub.
     * @example
     * return hub.connect();
     */
    connect() {
      let owned: ReadableStreamDefaultController<Uint8Array> | undefined;
      const stream = new ReadableStream<Uint8Array>({
        /**
         * Register the stream's controller and send the opening comment.
         *
         * @param controller - The new stream's controller.
         * @example
         * start(controller);
         */
        start(controller) {
          owned = controller;
          clients.add(controller);
          controller.enqueue(encoder.encode(SSE_OPEN));
        },
        /**
         * Drop this client's controller when the browser disconnects.
         *
         * @example
         * cancel();
         */
        cancel() {
          if (owned) clients.delete(owned);
        }
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive"
        }
      });
    },
    /**
     * Push a `reload` frame to every connected client, dropping any closed ones.
     *
     * @example
     * hub.reloadAll();
     */
    reloadAll() {
      for (const controller of clients) {
        try {
          controller.enqueue(encoder.encode(SSE_RELOAD));
        } catch {
          clients.delete(controller);
        }
      }
    },
    /**
     * The number of currently-connected clients.
     *
     * @returns The live client count.
     * @example
     * hub.size();
     */
    size() {
      return clients.size;
    }
  };
}

/**
 * Build the live-reload-aware request handler for the dev server: serves the SSE
 * stream at {@link RELOAD_PATH}, injects the reload client into HTML responses (when
 * `liveReload`), and falls through to the {@link resolveCleanUrl} static resolver for
 * everything else.
 *
 * @param ctx - The cli plugin context (provides `config` + `state.fileResponse`).
 * @param hub - The reload hub the SSE endpoint connects to.
 * @returns The `fetch` handler passed to the static server.
 * @example
 * const handler = createDevHandler(ctx, hub);
 */
export function createDevHandler(
  ctx: CliPluginContext,
  hub: ReloadHub
): (request: Request) => Promise<Response> {
  return async request => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    if (pathname === RELOAD_PATH) return hub.connect();

    const resolved = resolveCleanUrl(ctx.config.outDir, pathname);
    if (resolved.file === null) return new Response("Not Found", { status: 404 });

    const response = ctx.state.fileResponse(resolved.file, resolved.status);
    if (ctx.config.liveReload && resolved.file.endsWith(".html")) {
      const html = injectReloadClient(await response.text());
      return new Response(html, {
        status: resolved.status,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
    return response;
  };
}

/**
 * Run the dev loop: an initial build, an in-process static server that injects the
 * live-reload client, a recursive watcher over `config.watchDirs`, and a debounced
 * rebuild that re-renders and pushes a browser reload. Resolves on SIGINT/SIGTERM,
 * which stops the server, closes the watchers, and cancels any pending rebuild.
 *
 * @param ctx - The cli plugin context (config, state seams, `require`).
 * @param port - The port to bind the dev server to.
 * @returns Resolves once the server has been torn down by a termination signal.
 * @example
 * await runDevServer(ctx, 4173);
 */
export async function runDevServer(ctx: CliPluginContext, port: number): Promise<void> {
  await ctx.require(buildPlugin).run();

  const hub = createReloadHub();
  const server = ctx.state.serveStatic({ port, fetch: createDevHandler(ctx, hub) });

  const rebuilder = createRebuilder({
    debounceMs: ctx.config.debounceMs,
    /**
     * Re-run the SSG build for a rebuild.
     *
     * @returns The rebuild summary.
     * @example
     * await runBuild();
     */
    runBuild() {
      return ctx.require(buildPlugin).run();
    },
    /**
     * Render the reload line and push a browser reload after a rebuild.
     *
     * @param info - The changed file plus the rebuild's page count and duration.
     * @example
     * onReloaded({ file: "a.md", pageCount: 1, durationMs: 10 });
     */
    onReloaded(info) {
      ctx.state.render.reload(info);
      hub.reloadAll();
    },
    /**
     * Render a rebuild failure (the dev loop keeps running).
     *
     * @param error - The thrown rebuild error.
     * @example
     * onError(new Error("boom"));
     */
    onError(error) {
      ctx.state.render.error("rebuild failed", error);
    }
  });

  const watchers = ctx.config.watchDirs.map(dir =>
    ctx.state.watch(dir, () => rebuilder.schedule(dir))
  );

  ctx.state.render.serverReady({
    local: `http://localhost:${port}`,
    network: ctx.state.networkUrl(port),
    watching: ctx.config.watchDirs
  });

  return installSignalTeardown(() => {
    rebuilder.cancel();
    for (const watcher of watchers) watcher.close();
    server.stop();
  });
}
