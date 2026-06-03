/**
 * @file cli plugin — state factory. Wires the default injectable seams: the Panel
 * renderer, a stdin y/N `confirm`, the `Date.now` clock, a recursive `node:fs.watch`
 * wrapper, and the `Bun.serve`/`Bun.file` static-server seams (resolved lazily, like
 * deploy's `defaultSpawn`, so a non-Bun runtime fails coded rather than as a raw
 * `TypeError` and tests can inject fakes). Unit tests swap any of these.
 */
import { watch } from "node:fs";
import { createInterface } from "node:readline";
import { networkUrl } from "./network";
import { createPanelRenderer } from "./render/panel";
import type {
  Config,
  FileResponseFunction,
  ServeStaticFunction,
  State,
  WatchHandle
} from "./types";

/** The minimal `Bun` global surface the static-server seams use. */
type BunRuntime = {
  serve(options: { port: number; fetch(request: Request): Response | Promise<Response> }): {
    stop(): void;
  };
  file(path: string): BodyInit;
};

/**
 * Resolve the `Bun` runtime global, or `undefined` when not running under Bun.
 *
 * @returns The Bun runtime, or `undefined`.
 * @example
 * const bun = bunRuntime();
 */
function bunRuntime(): BunRuntime | undefined {
  return (globalThis as { Bun?: BunRuntime }).Bun;
}

/**
 * Default static-server factory — resolves `Bun.serve` lazily at call time so the
 * server is only required when a long-running command actually starts one.
 *
 * @param options - Port + `fetch` handler (see {@link ServeStaticFunction}).
 * @returns The running server handle.
 * @throws {Error} When no Bun runtime is available to serve.
 * @example
 * defaultServeStatic({ port: 4173, fetch: () => new Response("ok") });
 */
const defaultServeStatic: ServeStaticFunction = options => {
  const runtime = bunRuntime();
  if (runtime === undefined) {
    throw new Error(
      "[web] cli: no Bun runtime available to start the server.\n  Run serve()/preview() under Bun, or inject state.serveStatic in tests."
    );
  }
  return runtime.serve(options);
};

/**
 * Default file-response factory — `new Response(Bun.file(path), { status })`. Resolves
 * `Bun.file` lazily so it is only required when a request is actually served.
 *
 * @param path - Absolute on-disk path to stream.
 * @param status - HTTP status for the response.
 * @returns The file `Response`.
 * @throws {Error} When no Bun runtime is available to read the file.
 * @example
 * defaultFileResponse("/dist/index.html", 200);
 */
const defaultFileResponse: FileResponseFunction = (path, status) => {
  const runtime = bunRuntime();
  if (runtime === undefined) {
    throw new Error(
      "[web] cli: no Bun runtime available to read files.\n  Run serve()/preview() under Bun, or inject state.fileResponse in tests."
    );
  }
  return new Response(runtime.file(path), { status });
};

/**
 * Default stdin y/N prompt. Reads a single line from `process.stdin` via
 * `node:readline` and resolves `true` only on an explicit `y`/`yes` (default `No`).
 * Tests inject a canned answer so no real TTY interaction occurs.
 *
 * @param question - The yes/no question to display.
 * @returns Resolves `true` when the user answered yes.
 * @example
 * await defaultConfirm("Deploy dist/?");
 */
function defaultConfirm(question: string): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    readline.question(`${question} [y/N] `, answer => {
      readline.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/**
 * Default recursive directory watcher — wraps `node:fs.watch` with `{ recursive: true }`
 * and adapts its handle to {@link WatchHandle}. Tests inject a fake emitter so no real
 * FS watch is registered.
 *
 * @param dir - The directory to watch recursively.
 * @param onChange - Invoked on any change beneath `dir`.
 * @returns A handle whose `close()` detaches the watcher.
 * @example
 * const handle = defaultWatch("content", () => rebuild());
 */
function defaultWatch(dir: string, onChange: () => void): WatchHandle {
  const watcher = watch(dir, { recursive: true }, () => onChange());
  return {
    /**
     * Detach the underlying `node:fs.watch` listener.
     *
     * @example
     * handle.close();
     */
    close() {
      watcher.close();
    }
  };
}

/**
 * Default LAN network-URL deriver — wraps {@link networkUrl} so the production seam
 * reads `node:os` interfaces while tests can inject a deterministic value.
 *
 * @param port - The port the server is bound to.
 * @returns The `http://<ip>:<port>` URL, or `null` when offline.
 * @example
 * defaultNetworkUrl(4173);
 */
function defaultNetworkUrl(port: number): string | null {
  return networkUrl(port);
}

/**
 * Create the initial cli plugin state with the production seams wired. Every field is
 * an injectable seam (`render`, `confirm`, `clock`, `watch`, the server factories,
 * and `networkUrl`) so commands run under unit tests without real sockets/FS/TTY.
 *
 * @param _ctx - Minimal context with global + config (unused — state is static).
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns The initial cli state.
 * @example
 * const state = createState({ global: {}, config });
 */
export function createState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return {
    render: createPanelRenderer(),
    confirm: defaultConfirm,
    clock: Date.now,
    watch: defaultWatch,
    serveStatic: defaultServeStatic,
    fileResponse: defaultFileResponse,
    networkUrl: defaultNetworkUrl
  };
}
