/**
 * Shared test helpers for the cli plugin: a line-capturing fake renderer and a mock
 * CliPluginContext factory, so command-level tests never open real sockets, watch the
 * FS, read stdin, or spawn subprocesses. Mirrors the deploy plugin's helpers.
 */
import { vi } from "vitest";
import type { CliPluginContext } from "../api";
import type {
  BuildSummary,
  CliRenderer,
  Config,
  DeployOutcome,
  State,
  WatchHandle
} from "../types";

/** A renderer that records every call so tests can assert what was rendered. */
export type CaptureRenderer = CliRenderer & {
  /** Ordered log of `[method, ...args]` tuples the renderer received. */
  calls: unknown[][];
  /** All lines the renderer would have written (header/built/serverReady flattened). */
  lines: string[];
};

/**
 * Build a {@link CaptureRenderer}: each method pushes a `[name, ...args]` tuple onto
 * `calls` so tests assert structure without parsing ANSI output.
 */
export function makeRenderer(): CaptureRenderer {
  const calls: unknown[][] = [];
  const lines: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    lines,
    header: record("header"),
    phase: record("phase"),
    built: record("built"),
    serverReady: record("serverReady"),
    rebuildStart: record("rebuildStart"),
    reload: record("reload"),
    deployed: record("deployed"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    heading: record("heading"),
    check: record("check")
  };
}

/** Build a complete cli Config with test defaults, overridable per call. */
export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    outDir: "dist",
    port: 4173,
    watchDirs: ["content", "src"],
    debounceMs: 150,
    notFoundFile: "404.html",
    liveReload: true,
    ...overrides
  };
}

/** A fake build plugin API result for cli tests. */
export type FakeBuildApi = {
  run: ReturnType<typeof vi.fn>;
  phases: ReturnType<typeof vi.fn>;
};

/** A fake deploy plugin API result for cli tests. */
export type FakeDeployApi = {
  init: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
  getLastDeployment: ReturnType<typeof vi.fn>;
};

/** Options for {@link makeCtx}. */
export type MakeCtxOptions = {
  /** Config overrides. */
  config?: Partial<Config>;
  /** Renderer (defaults to a fresh capture renderer). */
  render?: CliRenderer;
  /** State overrides (confirm/clock/watch/serveStatic/fileResponse/networkUrl). */
  state?: Partial<State>;
  /** The build summary `build.run()` resolves with. */
  buildResult?: BuildSummary;
  /** The deploy result `deploy.run()` resolves with (sans the `deployed` flag). */
  deployResult?: Omit<Extract<DeployOutcome, { deployed: true }>, "deployed">;
};

/** A no-op {@link WatchHandle}. */
function noopWatch(): WatchHandle {
  return {
    close() {
      // no-op
    }
  };
}

/**
 * Build a mock {@link CliPluginContext} plus the fake build/deploy APIs `require`
 * returns. The renderer, confirm, clock, watch and server seams are all injectable so
 * nothing real runs. `require(plugin)` returns the build or deploy fake by plugin name.
 */
export function makeCtx(options: MakeCtxOptions = {}): {
  ctx: CliPluginContext;
  render: CliRenderer;
  build: FakeBuildApi;
  deploy: FakeDeployApi;
} {
  const render = options.render ?? makeRenderer();
  const buildResult: BuildSummary = options.buildResult ?? {
    outDir: "dist",
    pageCount: 3,
    durationMs: 10
  };
  const deployResult = options.deployResult ?? {
    url: "https://example.pages.dev",
    deploymentId: "deploy-1",
    branch: "main",
    durationMs: 20
  };
  const build: FakeBuildApi = {
    run: vi.fn(async () => buildResult),
    phases: vi.fn(() => [])
  };
  const deploy: FakeDeployApi = {
    init: vi.fn(async () => ({ written: [], skipped: [], drifted: [] })),
    run: vi.fn(async () => deployResult),
    getLastDeployment: vi.fn(() => deployResult)
  };

  const state: State = {
    render,
    confirm: vi.fn(async () => false),
    select: vi.fn(async () => 0),
    clock: () => 1000,
    watch: vi.fn(() => noopWatch()),
    serveStatic: vi.fn(() => ({
      stop() {
        // no-op
      }
    })),
    fileResponse: vi.fn((filePath: string) => new Response(`file:${filePath}`)),
    // eslint-disable-next-line unicorn/no-null -- State.networkUrl returns `string | null`; tests default to offline.
    networkUrl: () => null,
    // eslint-disable-next-line unicorn/no-null -- State.fileMtime returns `number | null`; tests default to "missing" (every event is a change).
    fileMtime: () => null,
    ...options.state
  };

  const requireFn = vi.fn((plugin: { name: string }) => {
    if (plugin.name === "build") return build;
    if (plugin.name === "deploy") return deploy;
    throw new Error(`unexpected require(${plugin.name})`);
  });

  const ctx = {
    state,
    config: makeConfig(options.config),
    require: requireFn as unknown as CliPluginContext["require"],
    emit: vi.fn() as unknown as CliPluginContext["emit"]
  } satisfies CliPluginContext;

  return { ctx, render, build, deploy };
}
