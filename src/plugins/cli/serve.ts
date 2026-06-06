/**
 * @file cli plugin — the dev server (`serve()`): an initial build, an in-process
 * static server that injects a live-reload SSE client into HTML, a recursive watcher
 * over `config.watchDirs`, and a debounced rebuild that re-renders and pushes a
 * browser reload. Lifted from the blog `scripts/dev.ts` + `scripts/serve.ts`. The
 * server/watch/clock are all behind injectable state seams so nothing real runs in
 * tests; SIGINT/SIGTERM tear everything down and resolve the returned promise.
 */
import path from "node:path";
import { buildPlugin } from "../build";
import type { BuildRunOverrides } from "../build/types";
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
 * A debounced rebuild driver: coalesces a burst of change notifications into a single
 * `runBuild(changed)`, accumulates the changed paths across the window (handed to the
 * build for an incremental rebuild), guards against overlapping runs, and reports the
 * latest changed path + fresh summary once the rebuild settles.
 *
 * @example
 * const rebuilder = createRebuilder({ debounceMs: 150, runBuild, onReloaded, onError });
 * rebuilder.schedule("content/intro/en.md");
 */
export type Rebuilder = {
  /**
   * Queue a rebuild for the given changed path (debounced + coalesced). The path is both
   * reported as `ReloadInfo.file` (the latest one wins) and accumulated into the changed
   * set handed to `runBuild(changed)` so the build can re-do only what changed. `serve()`
   * passes the changed file path (or the watched directory when the platform reports no
   * filename — which the build treats as a full rebuild).
   *
   * @param file - The changed path to report + accumulate.
   * @returns Nothing.
   * @example
   * rebuilder.schedule("content/intro/en.md");
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
 * Run one rebuild and report the result. Announces the start (`onRebuildStart`), then
 * routes success to `onReloaded` and failure to `onError`.
 *
 * @param input - The rebuild dependencies + the changed file/paths.
 * @param input.runBuild - Runs one build (given the changed paths) and resolves with its summary.
 * @param input.onRebuildStart - Called with the changed file just before the build runs.
 * @param input.onReloaded - Called with the changed file + summary + the built `changed` set after a rebuild.
 * @param input.onError - Called when a rebuild throws.
 * @param input.file - The changed file to report alongside the summary.
 * @param input.changed - The accumulated changed paths handed to `runBuild` (incremental).
 * @returns Resolves once the rebuild settles (always — errors are routed, not thrown).
 * @example
 * await runOneRebuild({ runBuild, onReloaded, onError, file: "a.md", changed: ["a.md"] });
 */
async function runOneRebuild(input: {
  runBuild: (changed: readonly string[]) => Promise<BuildSummary>;
  onRebuildStart?: (file: string) => void;
  onReloaded: (info: ReloadInfo, changed: readonly string[]) => void;
  onError: (error: unknown) => void;
  file: string;
  changed: readonly string[];
}): Promise<void> {
  // Announce the rebuild so the renderer can show its compact in-place "rebuilding" line.
  input.onRebuildStart?.(input.file);
  try {
    // Run the build with the changed paths, then report the changed file + fresh summary
    // (forwarding the built paths so the caller can baseline exactly what succeeded).
    const summary = await input.runBuild(input.changed);
    input.onReloaded(
      {
        file: input.file,
        pageCount: summary.pageCount,
        durationMs: summary.durationMs
      },
      input.changed
    );
  } catch (error) {
    // Route failures to onError so the dev loop keeps running instead of throwing.
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
 * @param input.runBuild - Runs one build (given the changed paths) and resolves with its summary.
 * @param input.onRebuildStart - Called with the changed file just before each build runs.
 * @param input.onReloaded - Called with the changed file + summary + the built `changed` set after a rebuild.
 * @param input.onError - Called when a rebuild throws.
 * @returns The debounced rebuild driver.
 * @example
 * createRebuilder({ debounceMs: 150, runBuild, onReloaded, onError });
 */
export function createRebuilder(input: {
  debounceMs: number;
  runBuild: (changed: readonly string[]) => Promise<BuildSummary>;
  onRebuildStart?: (file: string) => void;
  onReloaded: (info: ReloadInfo, changed: readonly string[]) => void;
  onError: (error: unknown) => void;
}): Rebuilder {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingFile = "";
  // The changed paths accumulated since the last build started — snapshot + cleared per
  // pass so concurrent changes (incl. mid-build) feed exactly the next incremental build.
  const pendingChanged = new Set<string>();
  let building = false;
  let dirty = false;

  /**
   * Rebuild repeatedly until no change arrived mid-flight: each pass snapshots + clears
   * the accumulated changed paths, runs one build over them, then loops again if a
   * `schedule()` set `dirty` (and added more paths) while it ran, so no change is dropped.
   *
   * @returns Resolves once a pass completes with no pending change (errors are routed,
   *   never thrown).
   * @example
   * await drainPendingRebuilds();
   */
  const drainPendingRebuilds = async (): Promise<void> => {
    do {
      dirty = false;
      const changed = [...pendingChanged];
      pendingChanged.clear();
      await runOneRebuild({
        runBuild: input.runBuild,
        ...(input.onRebuildStart ? { onRebuildStart: input.onRebuildStart } : {}),
        onReloaded: input.onReloaded,
        onError: input.onError,
        file: pendingFile,
        changed
      });
    } while (dirty);
  };

  /**
   * Run the queued rebuild once the debounce timer fires. Marks `dirty` (instead of
   * running) when a rebuild is already underway, otherwise holds the in-flight flag
   * across a full {@link drainPendingRebuilds} so concurrent changes coalesce into
   * exactly one extra re-run.
   *
   * @returns Resolves once the rebuild (and any coalesced re-run) settles (errors are
   *   routed, never thrown).
   * @example
   * await fire();
   */
  const fire = async (): Promise<void> => {
    // The timer just fired; release it so a later schedule() arms a fresh one.
    timer = undefined;

    // A rebuild is already running: record the change so it gets a coalesced re-run.
    if (building) {
      dirty = true;
      return;
    }

    // Hold the in-flight flag across the drain so concurrent schedules coalesce, not overlap.
    building = true;
    await drainPendingRebuilds();
    building = false;
  };

  return {
    /**
     * Queue a rebuild for the given changed path (debounced + coalesced + accumulated).
     *
     * @param file - The changed path reported as `ReloadInfo.file` and added to the changed set.
     * @example
     * rebuilder.schedule("content/intro/en.md");
     */
    schedule(file) {
      pendingFile = file;
      pendingChanged.add(file);
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
 * Whether a changed path (relative to a watched dir) is editor/OS noise that is never a
 * page source: any hidden segment (`.DS_Store`, anything under `.git/` or `.cache/`,
 * vim `.*.swp`) or a `~` backup file. Checks every segment, not just the basename.
 *
 * @param filename - The changed path relative to its watched directory.
 * @returns `true` when the change should be ignored as noise.
 * @example
 * isNoisePath(".git/HEAD"); // true
 */
function isNoisePath(filename: string): boolean {
  const segments = filename.split(/[/\\]/);
  return segments.some(segment => segment.startsWith(".")) || filename.endsWith("~");
}

/**
 * A guard deciding whether one `fs.watch` notification should trigger a rebuild. It
 * exists because macOS `fs.watch({ recursive: true })` is noisy: per single save it
 * re-fires the same file many times AND reports the parent directory separately, and a
 * multi-second build starves the event loop so those echoes are delivered LATE (mid- or
 * post-build). Untamed, that made the dev loop rebuild 4+ times per keystroke.
 *
 * @example
 * const gate = createChangeGate({ outDir: "dist", fileMtime, now: Date.now });
 * if (gate.accept("content", "a/en.md")) rebuild();
 */
export type ChangeGate = {
  /**
   * Decide whether a change beneath `dir` warrants a rebuild.
   *
   * @param dir - The watched directory the event fired on.
   * @param filename - The changed path relative to `dir`, or `undefined` when the
   *   platform did not report one (then we conservatively accept).
   * @returns `true` to schedule a rebuild, `false` to ignore (noise / output / stale echo).
   * @example
   * gate.accept("content", "post/en.md");
   */
  accept(dir: string, filename: string | undefined): boolean;
  /**
   * Record that a build is starting now — the gate's high-water mark. Subsequent events
   * for files last modified at or before this instant are stale echoes and are ignored.
   *
   * @returns Nothing.
   * @example
   * gate.markBuildStart();
   */
  markBuildStart(): void;
  /**
   * Record the just-built bytes of exactly the paths a SUCCESSFUL build consumed as the new
   * "last successfully built" no-op baseline. Called AFTER a build SUCCEEDS with that build's
   * `changed` set, so a later byte-identical save (a double Ctrl-S, a `touch`, a
   * format-on-save that reverts) is recognized as a no-op and dropped. Scoping to the built
   * paths is what preserves the guarantee that a "save again to retry" after a FAILED build
   * is never dropped (a failed build commits nothing) — and that a file edited mid-build,
   * but not part of the build that just succeeded, is not falsely baselined.
   *
   * @param changed - The paths the just-succeeded build consumed (the rebuild's `changed` set).
   * @returns Nothing.
   * @example
   * gate.commitBuilt(["content/intro/en.md"]);
   */
  commitBuilt(changed: readonly string[]): void;
};

/**
 * Create a {@link ChangeGate} that drops four kinds of spurious change events before they
 * reach the debounced rebuilder: editor/OS noise (dotfiles, backups), writes under
 * `outDir` (the build's own output — a loop guard), the stale duplicate/parent-dir echoes
 * macOS fires for one save (a build-start high-water mark — a change whose mtime is at or
 * before the last build we started was already captured), and — when a `fileHash` seam is
 * supplied — a NO-OP save whose bytes are identical to the last successfully-built version
 * (a double Ctrl-S, a `touch`, a format-on-save that reverts). The no-op baseline is
 * recorded ONLY by {@link ChangeGate.commitBuilt} on build SUCCESS, scoped to that build's
 * paths — so a failed build commits nothing (a retry save always rebuilds) and a file
 * edited mid-build is never falsely baselined by another file's success. A genuinely newer
 * edit (even mid-build) and a deletion (missing file) always pass.
 *
 * @param input - The gate dependencies.
 * @param input.outDir - The build output directory whose writes must never re-trigger a build.
 * @param input.fileMtime - Resolves a path's mtime in ms (or `null` when missing).
 * @param input.now - Monotonic wall clock (ms) used for the build-start high-water mark.
 * @param input.fileHash - Resolves a path's content hash (or `null` when missing). Optional;
 *   defaults to `() => null`, which disables the no-op-save short-circuit (every edit passes).
 * @returns The change gate.
 * @example
 * const gate = createChangeGate({ outDir: "dist", fileMtime: state.fileMtime, now: state.clock, fileHash: state.fileHash });
 */
export function createChangeGate(input: {
  outDir: string;
  fileMtime: (filePath: string) => number | null;
  now: () => number;
  fileHash?: (filePath: string) => string | null;
}): ChangeGate {
  const outDirAbs = path.resolve(input.outDir);
  // eslint-disable-next-line unicorn/no-null -- the default seam reports "no hash" as null
  const fileHash = input.fileHash ?? ((): string | null => null);
  // High-water mark: when the most recent build STARTED. Initialized to serve-start so
  // files that existed before serve() (mtime in the past) never trigger a spurious build.
  let lastBuildStartedAt = input.now();
  // The bytes (hash by absolute path) of the LAST SUCCESSFUL build — the no-op baseline.
  // Written only by commitBuilt (on success, scoped to the built paths), so a failed build
  // never baselines anything and an identical retry save always rebuilds.
  const committedHash = new Map<string, string>();
  return {
    /**
     * Decide whether a change beneath `dir` warrants a rebuild (see {@link ChangeGate.accept}).
     *
     * @param dir - The watched directory the event fired on.
     * @param filename - The changed path relative to `dir` (or `undefined`).
     * @returns `true` to schedule a rebuild, `false` to ignore.
     * @example
     * gate.accept("content", "post/en.md");
     */
    accept(dir, filename) {
      // No path reported (some platforms): we cannot filter — rebuild to be safe.
      if (filename === undefined) return true;

      // Editor/OS noise (dotfiles, swap, backups) is never a page source.
      if (isNoisePath(filename)) return false;

      // The build writing under outDir must never re-trigger a build (loop guard).
      const changed = path.resolve(dir, filename);
      if (changed === outDirAbs || changed.startsWith(`${outDirAbs}${path.sep}`)) return false;

      // Stale echo: a file (or the parent dir) last modified strictly before the last
      // build we started was already captured (the save's mtime predates build start by
      // the debounce window). Strict `<` never drops a genuine edit that lands in the same
      // millisecond a build begins. A missing file (deletion, null) is a real change.
      const mtime = input.fileMtime(changed);
      if (mtime !== null && mtime < lastBuildStartedAt) return false;

      // No-op save: the bytes are identical to the last SUCCESSFULLY-built version, so
      // rebuilding would change nothing — drop it. A missing file (null hash) is a real
      // change (deletion); clear any stale baseline for it so a re-create rebuilds.
      const hash = fileHash(changed);
      if (hash === null) {
        committedHash.delete(changed);
        return true;
      }
      if (committedHash.get(changed) === hash) return false;
      return true;
    },
    /**
     * Advance the high-water mark to now (see {@link ChangeGate.markBuildStart}).
     *
     * @example
     * gate.markBuildStart();
     */
    markBuildStart() {
      lastBuildStartedAt = input.now();
    },
    /**
     * Baseline exactly the paths the just-succeeded build consumed (see {@link ChangeGate.commitBuilt}).
     *
     * @param changed - The paths the just-succeeded build consumed.
     * @example
     * gate.commitBuilt(["content/intro/en.md"]);
     */
    commitBuilt(changed) {
      // Re-hash each built path NOW and baseline it under the same absolute key accept uses
      // (scheduled paths are relative; path.resolve aligns them). A path whose hash is null
      // (e.g. a deletion) is simply not baselined.
      for (const file of changed) {
        const key = path.resolve(file);
        const hash = fileHash(key);
        if (hash !== null) committedHash.set(key, hash);
      }
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
  /**
   * Stop the heartbeat and close every connected SSE stream (teardown on SIGINT).
   *
   * @returns Nothing.
   * @example
   * hub.close();
   */
  close(): void;
};

/** The SSE comment line sent on connect to open the stream. */
const SSE_OPEN = ": connected\n\n";
/** The SSE frame pushed to reload a connected browser. */
const SSE_RELOAD = "event: reload\ndata: 1\n\n";
/** The SSE comment frame sent on the heartbeat to keep an idle stream warm. */
const SSE_PING = ": ping\n\n";
/** Default heartbeat interval (ms): one ping well under any 30s+ proxy idle window. */
const DEFAULT_HEARTBEAT_MS = 15_000;

/**
 * Create a {@link ReloadHub} backed by `ReadableStream` controllers. Each `connect()`
 * enqueues into a new stream; `reloadAll()` writes the reload frame to every live
 * controller (dropping any that have closed). A periodic heartbeat comment keeps idle
 * streams warm — belt-and-suspenders alongside the dev server's `idleTimeout: 0`, so a
 * quiet connection is never severed (which the browser surfaces as
 * `ERR_INCOMPLETE_CHUNKED_ENCODING` and then reconnects in a storm).
 *
 * @param options - Optional heartbeat tuning.
 * @param options.heartbeatMs - Heartbeat interval in ms (`0` disables). Default `15000`.
 * @returns The reload hub.
 * @example
 * const hub = createReloadHub();
 */
export function createReloadHub(options: { heartbeatMs?: number } = {}): ReloadHub {
  const encoder = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  /**
   * Enqueue one frame to every live controller, dropping any that have closed.
   *
   * @param frame - The SSE wire text to broadcast.
   * @example
   * broadcast(SSE_RELOAD);
   */
  const broadcast = (frame: string): void => {
    const bytes = encoder.encode(frame);
    for (const controller of clients) {
      try {
        controller.enqueue(bytes);
      } catch {
        clients.delete(controller);
      }
    }
  };

  // Heartbeat: ping live clients on an interval so a quiet stream is never dropped.
  // `unref` so the timer never keeps the process alive (tests + clean SIGINT exit).
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const heartbeat =
    heartbeatMs > 0 ? setInterval(() => broadcast(SSE_PING), heartbeatMs) : undefined;
  (heartbeat as { unref?: () => void } | undefined)?.unref?.();

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
      broadcast(SSE_RELOAD);
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
    },
    /**
     * Stop the heartbeat and close every live SSE stream (SIGINT/SIGTERM teardown).
     *
     * @example
     * hub.close();
     */
    close() {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      for (const controller of clients) {
        try {
          controller.close();
        } catch {
          // Already closed by the client — nothing to do.
        }
      }
      clients.clear();
    }
  };
}

/** The content-type sent on rewritten HTML responses (live-reload injection). */
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

/**
 * Re-render a static file response with the live-reload client injected, preserving
 * the resolved status. Reads the original body to text so {@link injectReloadClient}
 * can splice the snippet in before `</body>`.
 *
 * @param response - The original static file response to rewrite.
 * @param status - The resolved status to carry onto the rewritten response.
 * @returns A fresh HTML response containing the injected reload client.
 * @example
 * const injected = await injectReloadResponse(fileResponse, 200);
 */
async function injectReloadResponse(response: Response, status: number): Promise<Response> {
  const html = injectReloadClient(await response.text());
  return new Response(html, {
    status,
    headers: { "content-type": HTML_CONTENT_TYPE }
  });
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
    // Live-reload clients connect to the SSE endpoint; hand them the hub stream.
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    if (pathname === RELOAD_PATH) return hub.connect();

    // Map the clean URL to a built file, or 404 when nothing matches.
    const resolved = resolveCleanUrl(ctx.config.outDir, pathname);
    if (resolved.file === null) return new Response("Not Found", { status: 404 });

    // HTML pages get the reload snippet spliced in (when live-reload is on); everything else passes through.
    const response = ctx.state.fileResponse(resolved.file, resolved.status);
    const shouldInjectReload = ctx.config.liveReload && resolved.file.endsWith(".html");
    if (shouldInjectReload) return injectReloadResponse(response, resolved.status);
    return response;
  };
}

/**
 * Per-session dev feature opt-ins resolved from `ServeOptions`. The dev build skips these
 * expensive, preview-irrelevant outputs by default for a fast rebuild; a `true` flag
 * re-enables that one output for the session (e.g. `--og` while testing social cards).
 *
 * @example
 * const features: DevFeatures = { og: false, sitemap: false, feeds: false, localeRedirects: false };
 */
export type DevFeatures = {
  /** Generate OG images this session. */
  og: boolean;
  /** Generate `sitemap.xml` + `robots.txt` this session. */
  sitemap: boolean;
  /** Generate RSS/Atom/JSON feeds this session. */
  feeds: boolean;
  /** Generate i18n locale-redirect pages this session. */
  localeRedirects: boolean;
};

/**
 * Build the per-run {@link BuildRunOverrides} for a dev build from the session feature
 * opt-ins: minification is always off in dev (no benefit, slower), and each expensive
 * output stays off unless its flag re-enables it (`ogImage: false` disables OG generation
 * regardless of the persisted config). The persisted plugin config is never mutated — the
 * overrides apply to the dev run only.
 *
 * @param features - The resolved per-session dev feature opt-ins.
 * @returns The config overrides merged into the dev build run.
 * @example
 * devBuildOverrides({ og: false, sitemap: false, feeds: false, localeRedirects: false });
 */
export function devBuildOverrides(features: DevFeatures): BuildRunOverrides {
  return {
    minify: false,
    ...(features.feeds ? {} : { feeds: false }),
    ...(features.sitemap ? {} : { sitemap: false }),
    ...(features.og ? {} : { ogImage: false }),
    ...(features.localeRedirects ? {} : { localeRedirects: false })
  };
}

/**
 * Run the dev loop: an initial build, an in-process static server that injects the
 * live-reload client, a recursive watcher over `config.watchDirs`, and a debounced
 * rebuild that re-renders and pushes a browser reload. Resolves on SIGINT/SIGTERM,
 * which stops the server, closes the watchers, and cancels any pending rebuild. The dev
 * build disables minification + expensive outputs (per {@link devBuildOverrides}); every
 * rebuild also skips the clean so caches + unchanged assets survive (no mid-rebuild 404).
 * Because rebuilds skip the clean, a DELETED or renamed content slug's stale page lingers
 * (and is served) until you restart `serve` or run a production `build`.
 *
 * @param ctx - The cli plugin context (config, state seams, `require`).
 * @param port - The port to bind the dev server to.
 * @param features - Per-session dev feature opt-ins (`og`/`sitemap`/`feeds`/`localeRedirects`).
 * @returns Resolves once the server has been torn down by a termination signal.
 * @example
 * await runDevServer(ctx, 4173, { og: false, sitemap: false, feeds: false, localeRedirects: false });
 */
export async function runDevServer(
  ctx: CliPluginContext,
  port: number,
  features: DevFeatures
): Promise<void> {
  const overrides = devBuildOverrides(features);

  // Initial build: a full clean build (fresh tree) with the dev overrides applied.
  await ctx.require(buildPlugin).run({ overrides });

  const hub = createReloadHub();
  // idleTimeout 0: never sever the long-lived live-reload SSE stream. Bun's 10s default
  // closes it, which the browser surfaces as ERR_INCOMPLETE_CHUNKED_ENCODING and then
  // reconnects forever (the __moku_reload request storm).
  const server = ctx.state.serveStatic({ port, idleTimeout: 0, fetch: createDevHandler(ctx, hub) });

  // Filter watch noise before scheduling: ignore build output + dotfiles/backups, drop the
  // stale duplicate/parent-dir echoes macOS fires per save (build-start high-water mark),
  // and drop a no-op save whose bytes match the last successful build (the double Ctrl-S
  // habit) — the hash baseline is committed in onReloaded (success) only.
  const gate = createChangeGate({
    outDir: ctx.config.outDir,
    fileMtime: ctx.state.fileMtime,
    now: ctx.state.clock,
    fileHash: ctx.state.fileHash
  });

  const rebuilder = createRebuilder({
    debounceMs: ctx.config.debounceMs,
    /**
     * Re-run the SSG build for a rebuild: skip the clean so the prior assets + on-disk
     * caches survive (and no in-flight request hits an empty outDir), with the dev
     * overrides applied.
     *
     * @param changed - The paths changed since the last build (incremental rebuild hint).
     * @returns The rebuild summary.
     * @example
     * await runBuild(["content/intro/en.md"]);
     */
    runBuild(changed) {
      return ctx.require(buildPlugin).run({ skipClean: true, overrides, changed });
    },
    /**
     * Show the compact in-place "rebuilding {label}" line before the build runs.
     *
     * @param file - The changed watch target shown in the line.
     * @example
     * onRebuildStart("content");
     */
    onRebuildStart(file) {
      // Advance the gate's high-water mark so this build's own duplicate/late watch
      // echoes are recognized as stale and never queue another rebuild.
      gate.markBuildStart();
      ctx.state.render.rebuildStart(file);
    },
    /**
     * Render the reload line and push a browser reload after a rebuild.
     *
     * @param info - The changed file plus the rebuild's page count and duration.
     * @param changed - The paths this successful build consumed (baselined for no-op drops).
     * @example
     * onReloaded({ file: "a.md", pageCount: 1, durationMs: 10 }, ["content/a.md"]);
     */
    onReloaded(info, changed) {
      // Build succeeded: baseline exactly the paths it built so a later byte-identical save
      // is dropped — while a file edited mid-build (not in this set) stays rebuildable.
      gate.commitBuilt(changed);
      ctx.state.render.reload(info);
      hub.reloadAll();
    },
    /**
     * Render a rebuild failure (the dev loop keeps running). A failed build baselines
     * nothing (commitBuilt only runs on success), so an identical retry save still rebuilds.
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
    ctx.state.watch(dir, filename => {
      if (!gate.accept(dir, filename)) return;
      // Schedule the changed file path (so the build can re-do only what changed). When the
      // platform reports no filename, schedule the watched dir — the build classifies that
      // unclassifiable path as a full rebuild.
      rebuilder.schedule(filename === undefined ? dir : path.join(dir, filename));
    })
  );

  ctx.state.render.serverReady({
    local: `http://localhost:${port}`,
    network: ctx.state.networkUrl(port),
    watching: ctx.config.watchDirs
  });

  return installSignalTeardown(() => {
    rebuilder.cancel();
    for (const watcher of watchers) watcher.close();
    hub.close();
    server.stop();
    // Stop the persistent idle-pulse ticker so it never outlives the dev server.
    ctx.state.render.dispose();
  });
}
