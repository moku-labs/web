/**
 * @file cli plugin — state factory. Wires the default injectable seams: the Panel
 * renderer, a stdin y/N `confirm`, the `Date.now` clock, a recursive `node:fs.watch`
 * wrapper, and the `Bun.serve`/`Bun.file` static-server seams (resolved lazily, like
 * deploy's `defaultSpawn`, so a non-Bun runtime fails coded rather than as a raw
 * `TypeError` and tests can inject fakes). Unit tests swap any of these.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync, watch } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { makePalette, supportsColor, supportsTruecolor, visibleWidth } from "@moku-labs/common/cli";
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

/** Prompt rail width — matches the renderer's `RAIL_WIDTH` so the hint aligns with other rows. */
const PROMPT_WIDTH = 66;

/** Whether the interactive prompts render with the MOKU marker styling (color/TTY only). */
const PROMPT_COLOR = supportsColor();

/** Shared palette for the interactive prompts (same brand colors as the Panel renderer). */
const PROMPT_PALETTE = makePalette(PROMPT_COLOR, PROMPT_COLOR && supportsTruecolor());

/**
 * Build the styled y/N confirm prompt: a brand `◆` marker + the question on the left,
 * a dim `y / N` hint + cyan `›` caret right-aligned to {@link PROMPT_WIDTH}. Falls back
 * to the plain `question [y/N] ` form off a color TTY (CI/pipes), where prompts rarely run.
 *
 * @param question - The yes/no question to display.
 * @returns The readline prompt string (the typed answer follows the caret).
 * @example
 * confirmPrompt("Deploy dist/ to Cloudflare Pages?");
 */
function confirmPrompt(question: string): string {
  if (!PROMPT_COLOR) return `${question} [y/N] `;
  const left = `  ${PROMPT_PALETTE.pink("◆")} ${question}`;
  const right = `${PROMPT_PALETTE.dim("y / N")} ${PROMPT_PALETTE.cyan("›")} `;
  const gap = Math.max(1, PROMPT_WIDTH - visibleWidth(left) - visibleWidth(right));
  return `${left}${" ".repeat(gap)}${right}`;
}

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
    readline.question(confirmPrompt(question), answer => {
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
    // biome-ignore lint/suspicious/noConsole: interactive prompt writes the question + choices to stdout.
    console.log(selectChoicesBlock(question, choices));
    readline.question(selectPrompt(question, choices.length), answer => {
      readline.close();
      const picked = Number.parseInt(answer.trim(), 10);
      const valid = Number.isInteger(picked) && picked >= 1 && picked <= choices.length;
      resolve(valid ? picked - 1 : 0);
    });
  });
}

/**
 * Render the select block: a brand `◆` marker + the question, then each choice as an
 * indented dim number + label. Off a color TTY, falls back to the plain `  N) label`
 * list (the question rides the prompt instead).
 *
 * @param question - The prompt shown above the choices (styled mode only).
 * @param choices - The selectable option labels.
 * @returns The multi-line choices block.
 * @example
 * selectChoicesBlock("Set up a workflow?", ["Auto", "Manual", "Skip"]);
 */
function selectChoicesBlock(question: string, choices: readonly string[]): string {
  if (!PROMPT_COLOR) {
    return choices.map((choice, index) => `  ${index + 1}) ${choice}`).join("\n");
  }
  const head = `  ${PROMPT_PALETTE.pink("◆")} ${question}`;
  const rows = choices.map(
    (choice, index) => `      ${PROMPT_PALETTE.dim(String(index + 1))}  ${choice}`
  );
  return [head, ...rows].join("\n");
}

/**
 * Build the select input prompt: a dim `pick 1–N` hint + cyan `›` caret in styled mode,
 * or the plain `question [1-N] ` form off a color TTY (where the question is not printed
 * separately).
 *
 * @param question - The prompt (used only by the plain fallback).
 * @param count - The number of choices.
 * @returns The readline prompt string.
 * @example
 * selectPrompt("Set up a workflow?", 3);
 */
function selectPrompt(question: string, count: number): string {
  if (!PROMPT_COLOR) return `${question} [1-${count}] `;
  const hint = PROMPT_PALETTE.dim(`pick 1–${count}`);
  const caret = PROMPT_PALETTE.cyan("›");
  return `    ${hint} ${caret} `;
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
 * Default file-content-hash probe — `sha256` of the file bytes, returning `null` for a
 * missing/unreadable path. serve()'s change gate compares this against the last
 * successfully-built bytes to drop a no-op save (a byte-identical double Ctrl-S).
 *
 * @param filePath - The absolute path to hash.
 * @returns The hex SHA-256 of the file's bytes, or `null` when it cannot be read.
 * @example
 * const hash = defaultFileHash("/abs/content/a.md");
 */
function defaultFileHash(filePath: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
  } catch {
    // eslint-disable-next-line unicorn/no-null -- contract: null signals a missing/unreadable file.
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

/** The real version/runtime facts shown in the Panel banner (resolved once per process). */
type BannerFacts = {
  /** The display version: `v{release}` when published, else `dev·{commit}` from git, else `dev`. */
  version: string;
  /** The pinned `@moku-labs/core` version (from the framework's own dependencies). */
  coreVersion: string;
};

/** Memoized banner facts — resolution touches the filesystem + git once, then caches. */
let cachedBanner: BannerFacts | undefined;

/**
 * Run a read-only `git` command in `dir`, returning its trimmed stdout (`undefined` on
 * any failure — not a checkout, git missing, etc.). A thin wrapper so the version
 * resolver can issue a couple of git queries without repeating the spawn boilerplate.
 *
 * @param dir - The working directory to run git in.
 * @param args - The git arguments (no user input is ever interpolated).
 * @returns The trimmed command output, or `undefined` on failure.
 * @example
 * git("/Users/me/moku/web", ["tag", "--list", "v*"]);
 */
function git(dir: string, args: string[]): string | undefined {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- `git` from PATH is intended; read-only, fixed args, no user input.
    return execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * The framework's source/dev version, derived the SAME way the publish workflow computes
 * a release: the highest semver `v*` tag is the source of truth (`@moku-labs/web` is
 * released tag-only — the working-tree `package.json` deliberately carries no `version`).
 * A `-dev` suffix marks it as a local build off that release line (e.g. `v1.1.0-dev`), so
 * it never masquerades as the published release. Falls back to the short commit (then
 * `undefined`) only when no tags exist. `undefined` when `dir` is not a git checkout (a
 * published npm install — which carries its real `version` instead).
 *
 * @param dir - A directory inside the framework's own repository (the realpath of the
 *   package root, so a symlinked local checkout reports the framework's tag — not the
 *   consumer's).
 * @returns The dev version (e.g. `v1.1.0-dev`), or `undefined`.
 * @example
 * devVersion("/Users/me/moku/web"); // "v1.1.0-dev"
 */
function devVersion(dir: string): string | undefined {
  // Mirror publish.yml: `git tag --list 'v*' --sort=-v:refname | head -n1`.
  const latestTag = git(dir, ["tag", "--list", "v*", "--sort=-v:refname"])?.split("\n")[0]?.trim();
  if (latestTag) return `${latestTag}-dev`;
  // No tags yet — fall back to the short commit so the build is still identifiable.
  const sha = git(dir, ["rev-parse", "--short", "HEAD"]);
  return sha ? `${sha}-dev` : undefined;
}

/**
 * Resolve the real version/runtime facts shown in the Panel banner (memoized). Reads the
 * `package.json` shipped beside the built bundle (`dist/../package.json`): a PUBLISHED
 * release carries a `version` and reports `v{version}`; a source/dev build (no `version`
 * field — `@moku-labs/web` is released tag-only) reports the latest semver tag + `-dev`
 * (e.g. `v1.1.0-dev`, the same tag the publish workflow treats as the version source), or
 * `"dev"` when git is unavailable. The pinned `@moku-labs/core` version comes from the
 * same file's `dependencies`.
 *
 * @returns The resolved {@link BannerFacts}.
 * @example
 * resolveBanner(); // { version: "v1.1.0-dev", coreVersion: "0.1.0-alpha.6" }
 */
function resolveBanner(): BannerFacts {
  if (cachedBanner) return cachedBanner;

  let pkg: { version?: string; dependencies?: Record<string, string> } = {};
  let pkgDir: string | undefined;
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    pkgDir = realpathSync(path.dirname(fileURLToPath(pkgUrl)));
    pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as typeof pkg;
  } catch {
    // No package.json beside the module (source/test run) — fall through to the dev defaults.
  }

  const coreRange = pkg.dependencies?.["@moku-labs/core"] ?? "";
  const coreVersion = coreRange.replace(/^\D*/, "") || "unknown";

  // A published release reports its package.json version; a source/dev build derives it
  // from the latest semver tag (the release source of truth), suffixed `-dev`.
  const released = pkg.version;
  let version = "dev";
  if (released) {
    version = `v${released}`;
  } else {
    const dev = devVersion(pkgDir ?? process.cwd());
    if (dev) version = dev;
  }

  cachedBanner = { version, coreVersion };
  return cachedBanner;
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
  const banner = resolveBanner();
  return {
    render: createPanelRenderer({ version: banner.version, coreVersion: banner.coreVersion }),
    confirm: defaultConfirm,
    select: defaultSelect,
    clock: Date.now,
    watch: defaultWatch,
    serveStatic: defaultServeStatic,
    fileResponse: defaultFileResponse,
    networkUrl: defaultNetworkUrl,
    fileMtime: defaultFileMtime,
    fileHash: defaultFileHash
  };
}
