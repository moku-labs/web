/**
 * @file cli plugin — type definitions (Config, State, the Panel renderer surface,
 * the public Api, and command-option/outcome shapes).
 */
import type * as Build from "../build/types";
import type * as Deploy from "../deploy/types";

/**
 * A cli error `code` from the config-validation and runtime taxonomy. Mirrors the
 * deploy plugin's coded-error pattern so every thrown value carries a stable `code`.
 *
 * @example
 * const code: CliErrorCode = "ERR_CLI_CONFIG";
 */
export type CliErrorCode = "ERR_CLI_CONFIG" | "ERR_CLI_NOT_FOUND";

/**
 * The four commands a single cli process can run. Each maps to one consumer script
 * (`scripts/{build,serve,preview,deploy}.ts`) and is rendered as the Panel header.
 *
 * @example
 * const command: Command = "build";
 */
export type Command = "build" | "serve" | "preview" | "deploy";

/**
 * Information rendered into the bordered server-ready panel by `serve()`/`preview()`.
 *
 * @example
 * const info: ServerInfo = { local: "http://localhost:4173", network: null };
 */
export type ServerInfo = {
  /** The loopback URL the server is reachable at (e.g. `http://localhost:4173`). */
  local: string;
  /** The LAN URL derived from the first non-internal IPv4, or `null` when offline. */
  network: string | null;
  /** Directories `serve()` is watching for changes (omitted by `preview()`). */
  watching?: string[];
};

/**
 * Information rendered after a single `serve()` rebuild: which file changed plus the
 * fresh build summary used to print the "rebuilt N pages" line.
 *
 * @example
 * const info: ReloadInfo = { file: "content/post.md", pageCount: 12, durationMs: 84 };
 */
export type ReloadInfo = {
  /** The changed path that triggered the rebuild. */
  file: string;
  /** Number of route pages rendered by the rebuild. */
  pageCount: number;
  /** Wall-clock duration of the rebuild in milliseconds. */
  durationMs: number;
};

/**
 * The Panel renderer surface — every line of terminal output flows through this so
 * tests can inject a line-capturing fake. Implemented by `createPanelRenderer` and
 * is TTY/`NO_COLOR`-aware (box-drawing + color on a TTY, plain lines otherwise).
 *
 * @example
 * const render: CliRenderer = createPanelRenderer();
 * render.header("build");
 */
export type CliRenderer = {
  /**
   * Render the boxed `MOKU WEB` logo + command label. Called once per command (one
   * command = one process), so it never repeats within a run.
   *
   * @param command - The command being run, shown beside the logo.
   * @returns Nothing.
   * @example
   * render.header("serve");
   */
  header(command: Command): void;
  /**
   * Render a live per-phase row from a `build:phase` event.
   *
   * @param phase - The `build:phase` payload (`{ phase, status, durationMs? }`).
   * @returns Nothing.
   * @example
   * render.phase({ phase: "pages", status: "done", durationMs: 12 });
   */
  phase(phase: Build.BuildEvents["build:phase"]): void;
  /**
   * Render the BUILD summary block from a `build:complete` event.
   *
   * @param summary - The `build:complete` payload (`{ outDir, pageCount, durationMs }`).
   * @returns Nothing.
   * @example
   * render.built({ outDir: "dist", pageCount: 12, durationMs: 840 });
   */
  built(summary: Build.BuildEvents["build:complete"]): void;
  /**
   * Render the bordered server-ready panel (Local / Network URLs + watched dirs).
   *
   * @param info - Local/Network URLs and optionally the watched directories.
   * @returns Nothing.
   * @example
   * render.serverReady({ local: "http://localhost:4173", network: null });
   */
  serverReady(info: ServerInfo): void;
  /**
   * Render the post-rebuild line ("~ file" + "✓ rebuilt N pages · Xms · reloaded").
   *
   * @param info - The changed file plus the rebuild's page count and duration.
   * @returns Nothing.
   * @example
   * render.reload({ file: "content/a.md", pageCount: 12, durationMs: 84 });
   */
  reload(info: ReloadInfo): void;
  /**
   * Render the deploy result panel from a `deploy:complete` event.
   *
   * @param result - The `deploy:complete` payload (`{ url, deploymentId, branch, durationMs }`).
   * @returns Nothing.
   * @example
   * render.deployed({ url: "https://x.pages.dev", deploymentId: "id", branch: "main", durationMs: 1200 });
   */
  deployed(result: Deploy.DeployResult): void;
  /**
   * Render a neutral informational line (e.g. the non-interactive deploy note, watch notice).
   *
   * @param message - The line to print.
   * @returns Nothing.
   * @example
   * render.info("watching for changes…");
   */
  info(message: string): void;
  /**
   * Render a warning line (written to stderr).
   *
   * @param message - The warning to print.
   * @returns Nothing.
   * @example
   * render.warn("deploy skipped");
   */
  warn(message: string): void;
  /**
   * Render an error line (written to stderr), optionally with a cause.
   *
   * @param message - The error summary to print.
   * @param cause - Optional underlying error/value to print beneath the summary.
   * @returns Nothing.
   * @example
   * render.error("build failed", err);
   */
  error(message: string, cause?: unknown): void;
};

/**
 * A live directory watcher handle returned by the injectable `watch` seam. Closing
 * it detaches the underlying `node:fs.watch` listener.
 *
 * @example
 * const handle: WatchHandle = state.watch("content", onChange);
 * handle.close();
 */
export type WatchHandle = {
  /**
   * Stop watching and release the underlying listener.
   *
   * @returns Nothing.
   * @example
   * handle.close();
   */
  close(): void;
};

/**
 * A running static server handle the cli stops on teardown. Declared structurally
 * (no Bun namespace types) so it survives `.d.ts` bundling and tests can supply a
 * fake without importing Bun.
 *
 * @example
 * const handle: ServerHandle = state.serveStatic({ port, fetch });
 * handle.stop();
 */
export type ServerHandle = {
  /**
   * Stop the server and release its socket.
   *
   * @returns Nothing.
   * @example
   * handle.stop();
   */
  stop(): void;
};

/**
 * The subset of `Bun.serve`'s options the cli uses: a port plus a `fetch` handler.
 * Declared structurally so no Bun namespace type reaches the public surface.
 *
 * @example
 * const opts: ServeStaticOptions = { port: 4173, fetch: () => new Response("ok") };
 */
export type ServeStaticOptions = {
  /** Port to bind the server to. */
  port: number;
  /**
   * Per-request handler returning the response (sync or async).
   *
   * @param request - The incoming request.
   * @returns The response (or a promise of it).
   * @example
   * fetch(req) { return new Response("ok"); }
   */
  fetch(request: Request): Response | Promise<Response>;
};

/**
 * An injectable static-server factory (defaults to `Bun.serve`). Keeps the Bun
 * runtime dependency behind a structural seam so `serve()`/`preview()` never open a
 * real socket in tests.
 *
 * @example
 * const serveStatic: ServeStaticFunction = options => Bun.serve(options);
 */
export type ServeStaticFunction = (options: ServeStaticOptions) => ServerHandle;

/**
 * An injectable file-response factory (defaults to `new Response(Bun.file(path))`).
 * Maps a resolved on-disk path + status to the response body the server returns.
 *
 * @example
 * const fileResponse: FileResponseFunction = (path, status) => new Response(Bun.file(path), { status });
 */
export type FileResponseFunction = (path: string, status: number) => Response;

/**
 * Configuration for the cli plugin — the complete resolved `Config` (not a partial).
 * Consumers override individual fields via `pluginConfigs.cli`.
 *
 * @example
 * const config: Config = {
 *   outDir: "dist", port: 4173, watchDirs: ["content", "src"],
 *   debounceMs: 150, notFoundFile: "404.html", liveReload: true
 * };
 */
export type Config = {
  /** Build output directory; served by preview, asserted by build, rebuilt by serve. Default `"dist"`. */
  outDir: string;
  /** Default port for serve()/preview() (overridable per-call via options.port). Default `4173`. */
  port: number;
  /** Directories serve() watches for changes (recursive). Default `["content", "src"]`. */
  watchDirs: string[];
  /** Debounce window (ms) coalescing FS-event bursts into one rebuild. Default `150`. */
  debounceMs: number;
  /** Filename build() asserts exists at outDir root (CF Pages flips to SPA mode without it). Default `"404.html"`. */
  notFoundFile: string;
  /** Inject the live-reload SSE client into HTML during serve() (never during preview()). Default `true`. */
  liveReload: boolean;
};

/**
 * Runtime state for the cli plugin — injectable seams so every command is testable
 * without real sockets/FS-watch/TTY (mirrors deploy's injectable `spawn`).
 *
 * @example
 * const state: State = createState();
 */
export type State = {
  /** Panel renderer — all terminal output flows through this. Tests inject a line-capturing fake. */
  render: CliRenderer;
  /**
   * Interactive y/N prompt used by deploy(). Default reads stdin (TTY); tests inject a canned answer.
   *
   * @param question - The yes/no question to display.
   * @returns Resolves `true` when the user answered yes.
   * @example
   * const ok = await state.confirm("Deploy dist/?");
   */
  confirm: (question: string) => Promise<boolean>;
  /**
   * Monotonic clock for durations. Default `Date.now`; tests inject for deterministic timing.
   *
   * @returns The current time in milliseconds.
   * @example
   * const t = state.clock();
   */
  clock: () => number;
  /**
   * Recursive directory watcher factory used by serve(). Default wraps `node:fs.watch`;
   * tests inject a fake emitter.
   *
   * @param dir - The directory to watch recursively.
   * @param onChange - Invoked on any change beneath `dir`.
   * @returns A handle whose `close()` detaches the watcher.
   * @example
   * const handle = state.watch("content", () => rebuild());
   */
  watch: (dir: string, onChange: () => void) => WatchHandle;
  /** Static-server factory used by serve()/preview(). Default `Bun.serve`; tests inject a fake. */
  serveStatic: ServeStaticFunction;
  /** File-response factory mapping a resolved path + status to a `Response`. Default `Bun.file`. */
  fileResponse: FileResponseFunction;
  /**
   * LAN network-URL deriver for the server-ready panel. Default reads `node:os`
   * interfaces; tests inject a deterministic value.
   *
   * @param port - The port the server is bound to.
   * @returns The `http://<ip>:<port>` URL, or `null` when offline.
   * @example
   * const url = state.networkUrl(4173);
   */
  networkUrl: (port: number) => string | null;
};

/**
 * Summary returned by `cli.build()` — the awaited `build.run()` result.
 *
 * @example
 * const summary: BuildSummary = { outDir: "dist", pageCount: 12, durationMs: 840 };
 */
export type BuildSummary = {
  /** Resolved output directory the site was written to. */
  outDir: string;
  /** Number of route pages rendered. */
  pageCount: number;
  /** Total wall-clock duration of the run, in milliseconds. */
  durationMs: number;
};

/**
 * Outcome returned by `cli.deploy()` — either a completed deploy (with details) or a
 * skipped one. A skip happens only when an interactive TTY user answers "no" at the
 * confirm prompt (`reason: "declined"`). Non-interactive runs (CI / non-TTY) never
 * prompt and always proceed, so they never skip — the scripts are CI-safe.
 *
 * @example
 * const outcome: DeployOutcome = { deployed: false, reason: "declined" };
 */
export type DeployOutcome =
  | { deployed: true; url: string; deploymentId: string; branch: string; durationMs: number }
  | { deployed: false; reason: "declined" };

/**
 * Options for `cli.build()`.
 *
 * @example
 * await app.cli.build({ assertNotFound: false });
 */
export type BuildOptions = {
  /** Assert `outDir/notFoundFile` exists after the build. Defaults to `true`. */
  assertNotFound?: boolean;
};

/**
 * Options for `cli.serve()`.
 *
 * @example
 * await app.cli.serve({ port: 3000 });
 */
export type ServeOptions = {
  /** Port to bind the dev server to. Defaults to `config.port`. */
  port?: number;
  /** Reserved for opening the browser on start (not yet implemented). Defaults to `false`. */
  open?: boolean;
};

/**
 * Options for `cli.preview()`.
 *
 * @example
 * await app.cli.preview({ port: 8080 });
 */
export type PreviewOptions = {
  /** Port to bind the preview server to. Defaults to `config.port`. */
  port?: number;
};

/**
 * Options for `cli.deploy()`.
 *
 * @example
 * await app.cli.deploy({ branch: "preview/x", yes: true });
 */
export type DeployOptions = {
  /** Branch to deploy. Defaults to the deploy plugin's production branch. */
  branch?: string;
  /** Skip the y/N confirm and deploy immediately. Defaults to `false`. */
  yes?: boolean;
};

/**
 * Public API of the cli plugin (mounted at `app.cli`) — exactly four methods.
 *
 * @example
 * await app.cli.build();
 */
export type Api = {
  /**
   * Run the SSG build and assert the not-found page exists.
   *
   * @param options - Optional `assertNotFound` toggle (default `true`).
   * @returns The build summary (`outDir`, `pageCount`, `durationMs`).
   * @throws {Error} `ERR_CLI_NOT_FOUND` when the not-found page is missing and asserted.
   * @example
   * const summary = await app.cli.build();
   */
  build(options?: BuildOptions): Promise<BuildSummary>;
  /**
   * Dev loop: build once, serve `dist/` in-process (live-reload injected), watch
   * `watchDirs`, debounced rebuild + reload. Resolves when SIGINT/SIGTERM tears down.
   *
   * @param options - Optional port override.
   * @returns Resolves once the server has been torn down.
   * @example
   * await app.cli.serve({ port: 3000 });
   */
  serve(options?: ServeOptions): Promise<void>;
  /**
   * Static preview of the built `dist/` with CF-Pages clean-URL resolution. No
   * reload injection (mirrors production). Resolves on SIGINT/SIGTERM.
   *
   * @param options - Optional port override.
   * @returns Resolves once the server has been torn down.
   * @example
   * await app.cli.preview();
   */
  preview(options?: PreviewOptions): Promise<void>;
  /**
   * Scaffold, then deploy. A y/N confirm is shown only on an interactive TTY;
   * non-interactive runs (CI, or any non-TTY) skip the prompt and deploy, so the
   * consumer scripts never block a pipeline. `options.yes` forces the skip anywhere.
   *
   * @param options - Optional branch override and `yes` flag.
   * @returns The deploy outcome (completed details, or `declined` if a TTY user says no).
   * @example
   * await app.cli.deploy({ branch: "preview/x", yes: true });
   */
  deploy(options?: DeployOptions): Promise<DeployOutcome>;
};
