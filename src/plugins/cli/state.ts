/**
 * @file cli plugin — state factory. Wires the default injectable seams: the Panel
 * renderer, a stdin y/N `confirm`, the `Date.now` clock, a recursive `node:fs.watch`
 * wrapper, and the `Bun.serve`/`Bun.file` static-server seams (resolved lazily, like
 * deploy's `defaultSpawn`, so a non-Bun runtime fails coded rather than as a raw
 * `TypeError` and tests can inject fakes). Unit tests swap any of these.
 */
import { statSync, watch } from "node:fs";
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

/** Matches an explicit affirmative answer (`y`/`yes`, case-insensitive). */
const YES_PATTERN = /^y(es)?$/i;

/** The minimal `Bun` global surface the static-server seams use. */
type BunRuntime = {
  serve(options: {
    port: number;
    fetch(request: Request): Response | Promise<Response>;
    idleTimeout?: number;
  }): {
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
      resolve(YES_PATTERN.test(answer.trim()));
    });
  });
}

/**
 * Default stdin single-choice prompt. Prints the choices numbered from 1, reads a line
 * via `node:readline`, and resolves the chosen zero-based index (empty / out-of-range
 * falls back to 0). Tests inject a canned selection so no real TTY interaction occurs.
 *
 * @param question - The prompt to display.
 * @param choices - The selectable option labels.
 * @returns Resolves the chosen zero-based index.
 * @example
 * await defaultSelect("Trigger?", ["Auto on push", "Manual only"]);
 */
function defaultSelect(question: string, choices: readonly string[]): Promise<number> {
  return new Promise<number>(resolve => {
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    for (const [index, choice] of choices.entries()) {
      // biome-ignore lint/suspicious/noConsole: interactive prompt writes the numbered choices to stdout.
      console.log(`  ${index + 1}) ${choice}`);
    }
    readline.question(`${question} [1-${choices.length}] `, answer => {
      readline.close();
      const picked = Number.parseInt(answer.trim(), 10);
      const valid = Number.isInteger(picked) && picked >= 1 && picked <= choices.length;
      resolve(valid ? picked - 1 : 0);
    });
  });
}

/**
 * Default recursive directory watcher — wraps `node:fs.watch` with `{ recursive: true }`
 * and adapts its handle to {@link WatchHandle}. Tests inject a fake emitter so no real
 * FS watch is registered.
 *
 * @param dir - The directory to watch recursively.
 * @param onChange - Invoked on any change beneath `dir`, forwarding the changed path
 *   relative to `dir` when `node:fs.watch` reports it (`undefined` otherwise).
 * @returns A handle whose `close()` detaches the watcher.
 * @example
 * const handle = defaultWatch("content", file => rebuild(file));
 */
function defaultWatch(dir: string, onChange: (filename?: string) => void): WatchHandle {
  const watcher = watch(dir, { recursive: true }, (_event, filename) =>
    onChange(typeof filename === "string" ? filename : undefined)
  );
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
 * Default file-mtime probe — `node:fs.statSync(path).mtimeMs`, returning `null` for a
 * missing path (so a deleted file still reads as a change). serve() compares this
 * across `fs.watch` events to drop the duplicate notifications macOS fires per save.
 *
 * @param filePath - The absolute path to stat.
 * @returns The modification time in epoch milliseconds, or `null` when absent.
 * @example
 * const mtime = defaultFileMtime("/abs/content/a.md");
 */
function defaultFileMtime(filePath: string): number | null {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    // eslint-disable-next-line unicorn/no-null -- contract: null signals a missing file (treated as a change).
    return null;
  }
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
    select: defaultSelect,
    clock: Date.now,
    watch: defaultWatch,
    serveStatic: defaultServeStatic,
    fileResponse: defaultFileResponse,
    networkUrl: defaultNetworkUrl,
    fileMtime: defaultFileMtime
  };
}
