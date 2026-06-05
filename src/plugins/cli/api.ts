/**
 * @file cli plugin — API factory (build · serve · preview · deploy), the cli plugin
 * context type, and config-only `validateConfig`. The four closures are wiring-thin:
 * each renders the Panel header, then delegates to `build`/`deploy` (via `require`)
 * or to the server modules. Live build/deploy progress arrives through hooks (in
 * `index.ts`), so the methods' return values come from the awaited `run()` results.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { EmitFn } from "@moku-labs/core";
import { buildPlugin } from "../build";
import { deployPlugin } from "../deploy";
import { cliError, ERROR_PREFIX } from "./errors";
import { runPreviewServer } from "./preview";
import { runDevServer } from "./serve";
import type { Api, Config, State } from "./types";

/** Lowest valid TCP port. */
const MIN_PORT = 1;
/** Highest valid TCP port. */
const MAX_PORT = 65_535;

/**
 * Structural extraction of a plugin instance's public API from its `_phantom`
 * carrier (mirrors the kernel's non-exported `ExtractPluginApi`) so the framework's
 * generic `require` is assignable to {@link CliRequire}.
 *
 * @example
 * type BuildApi = ExtractApi<typeof buildPlugin>;
 */
export type ExtractApi<PluginCandidate> = PluginCandidate extends {
  readonly _phantom: { readonly api: infer PluginApi };
}
  ? PluginApi
  : never;

/** Generic `require` closure for pulling a dependency plugin's API at run time. */
export type CliRequire = <
  PluginCandidate extends {
    readonly name: string;
    readonly spec: unknown;
    readonly _phantom: {
      readonly config: unknown;
      readonly state: unknown;
      readonly api: unknown;
      readonly events: Record<string, unknown>;
    };
  }
>(
  plugin: PluginCandidate
) => ExtractApi<PluginCandidate>;

/**
 * The event payload map cli listens to (build:phase/build:complete from build,
 * deploy:complete from deploy). cli emits none, but `emit` is part of the kernel
 * context, so it is typed against an empty map for structural assignability.
 *
 * @example
 * const emit: CliEmit = () => {};
 */
export type CliEvents = Record<never, never>;

/** Strictly-typed (no-op) emit closure — cli declares no events of its own. */
export type CliEmit = EmitFn<CliEvents>;

/**
 * The plugin-context slice the cli API and `serve`/`preview` modules consume: the
 * mutable `state` (the injectable seams), the resolved `config`, plus
 * `require`/`emit`. Typed to match the kernel's generic context so the framework
 * execution context is structurally assignable.
 *
 * @example
 * const ctx: CliPluginContext = { state, config, require, emit };
 */
export type CliPluginContext = {
  /** Mutable cli state (renderer + injectable seams). */
  state: State;
  /** Resolved, frozen cli config. */
  readonly config: Readonly<Config>;
  /** Resolve a depended-upon plugin instance to its public API. */
  require: CliRequire;
  /** Emit closure (cli declares no events; present for context compatibility). */
  emit: CliEmit;
};

/**
 * Validate the resolved cli config during `onInit` (config-only — no resource
 * allocation, per spec/06 §2). Throws `ERR_CLI_CONFIG` (`[web] cli: …`) when `port`
 * is not an integer in 1–65535, `outDir`/`notFoundFile` are not non-empty strings,
 * `watchDirs` is not a non-empty string array, or `debounceMs` is negative.
 *
 * @param config - The resolved cli configuration to validate.
 * @throws {Error} `ERR_CLI_CONFIG` when any field is invalid.
 * @example
 * validateConfig({ outDir: "dist", port: 4173, watchDirs: ["content"], debounceMs: 150, notFoundFile: "404.html", liveReload: true });
 */
export function validateConfig(config: Config): void {
  // Port must be a TCP port number — an integer within the valid range.
  if (!Number.isInteger(config.port) || config.port < MIN_PORT || config.port > MAX_PORT) {
    throw cliError(
      "ERR_CLI_CONFIG",
      `${ERROR_PREFIX}: port must be an integer in ${MIN_PORT}–${MAX_PORT}.\n  Set pluginConfigs.cli.port to a valid TCP port (e.g. 4173).`
    );
  }

  // Output directory must name a real build directory (non-empty string).
  if (typeof config.outDir !== "string" || config.outDir.length === 0) {
    throw cliError(
      "ERR_CLI_CONFIG",
      `${ERROR_PREFIX}: outDir must be a non-empty string.\n  Set pluginConfigs.cli.outDir to your build output directory (e.g. "dist").`
    );
  }

  // Not-found page filename must be a non-empty string.
  if (typeof config.notFoundFile !== "string" || config.notFoundFile.length === 0) {
    throw cliError(
      "ERR_CLI_CONFIG",
      `${ERROR_PREFIX}: notFoundFile must be a non-empty string.\n  Set pluginConfigs.cli.notFoundFile to the not-found page filename (e.g. "404.html").`
    );
  }

  // Watch list must be a non-empty array of non-empty directory names.
  if (
    !Array.isArray(config.watchDirs) ||
    config.watchDirs.length === 0 ||
    !config.watchDirs.every(dir => typeof dir === "string" && dir.length > 0)
  ) {
    throw cliError(
      "ERR_CLI_CONFIG",
      `${ERROR_PREFIX}: watchDirs must be a non-empty array of non-empty strings.\n  Set pluginConfigs.cli.watchDirs to the directories serve() should watch (e.g. ["content", "src"]).`
    );
  }

  // Debounce window must be a non-negative millisecond count.
  if (typeof config.debounceMs !== "number" || config.debounceMs < 0) {
    throw cliError(
      "ERR_CLI_CONFIG",
      `${ERROR_PREFIX}: debounceMs must be a number >= 0.\n  Set pluginConfigs.cli.debounceMs to the rebuild debounce window in milliseconds (e.g. 150).`
    );
  }
}

/**
 * Assert the SSG emitted the not-found page, rendering a hint and throwing
 * `ERR_CLI_NOT_FOUND` when it is missing (CF Pages flips to SPA mode without a
 * top-level 404). A no-op when the page exists.
 *
 * @param ctx - Plugin context (provides `state.render` for the failure hint).
 * @param page - The absolute path the not-found page is expected at.
 * @throws {Error} `ERR_CLI_NOT_FOUND` when the not-found page is missing.
 * @example
 * assertNotFoundPage(ctx, path.join(ctx.config.outDir, ctx.config.notFoundFile));
 */
function assertNotFoundPage(ctx: CliPluginContext, page: string): void {
  if (existsSync(page)) {
    return;
  }
  ctx.state.render.error(`${page} missing — set build.notFound (CF Pages would flip to SPA mode)`);
  throw cliError(
    "ERR_CLI_NOT_FOUND",
    `${ERROR_PREFIX}: ${page} missing after build.\n  Set build.notFound so the SSG emits it (CF Pages flips to SPA mode without a top-level 404), or pass { assertNotFound: false } to skip this check.`
  );
}

/**
 * Whether the deploy confirmation prompt should be shown to a human. True only on
 * an interactive TTY with `CI` unset and when the caller has not passed `yes`; CI
 * and non-TTY runs are not prompted so consumer scripts never block a pipeline.
 *
 * @param yes - The caller's `yes` flag (forces the prompt to be skipped anywhere).
 * @returns `true` when a confirmation prompt should be shown, otherwise `false`.
 * @example
 * if (shouldPromptDeploy(false)) { ... }
 */
function shouldPromptDeploy(yes: boolean): boolean {
  const isInteractiveTty = process.stdout.isTTY === true && process.env.CI === undefined;
  return isInteractiveTty && !yes;
}

/**
 * Resolve whether a deploy may proceed, handling the human/non-interactive split:
 * prompts an interactive TTY user (rendering the "skipped" warning on a "no"),
 * renders the non-interactive notice when no prompt and no `yes`, and otherwise
 * proceeds silently. Returns whether the caller should run the deploy.
 *
 * @param ctx - Plugin context (provides `state.confirm` and `state.render`).
 * @param yes - The caller's `yes` flag (forces the skip anywhere).
 * @returns `true` when the deploy should run, `false` when an interactive user declined.
 * @example
 * if (!(await confirmDeploy(ctx, false))) return { deployed: false, reason: "declined" };
 */
async function confirmDeploy(ctx: CliPluginContext, yes: boolean): Promise<boolean> {
  // Non-interactive (or `yes`): never prompt; note the skip when not forced by `yes`.
  if (!shouldPromptDeploy(yes)) {
    if (!yes) {
      ctx.state.render.info("non-interactive — skipping deploy confirmation");
    }
    return true;
  }

  // Interactive human: ask, and surface the skip when they decline.
  const confirmed = await ctx.state.confirm(`Deploy ${ctx.config.outDir}/ to cloudflare-pages?`);
  if (!confirmed) {
    ctx.state.render.warn("deploy skipped");
  }
  return confirmed;
}

/**
 * Create the cli plugin API surface — exactly `build`, `serve`, `preview`, `deploy`.
 * Each method renders `state.render.header(<command>)` first, then does its work;
 * live progress is rendered by the hooks wired in `index.ts`, so each method's
 * return value comes from the awaited `build.run()` / `deploy.run()` result.
 *
 * @param ctx - Plugin context (provides `require`, `state`, `config`).
 * @returns The {@link Api} surface mounted at `app.cli`.
 * @example
 * const api = createApi(ctx);
 * await api.build();
 */
export function createApi(ctx: CliPluginContext): Api {
  return {
    /**
     * Run the SSG build and (by default) assert the not-found page exists.
     *
     * @param options - Optional `assertNotFound` toggle (default `true`).
     * @returns The build summary (`outDir`, `pageCount`, `durationMs`).
     * @throws {Error} `ERR_CLI_NOT_FOUND` when the not-found page is missing and asserted.
     * @example
     * await api.build();
     */
    async build(options = {}) {
      const { assertNotFound = true } = options;

      // Render the command header, then run the SSG build (progress arrives via hooks).
      ctx.state.render.header("build");
      const result = await ctx.require(buildPlugin).run();

      // Unless opted out, fail loudly when the SSG skipped the top-level not-found page.
      if (assertNotFound) {
        assertNotFoundPage(ctx, path.join(ctx.config.outDir, ctx.config.notFoundFile));
      }

      return result;
    },

    /**
     * Dev loop: build once, serve `dist/` in-process (live-reload injected), watch
     * `watchDirs`, debounced rebuild + reload. Resolves on SIGINT/SIGTERM.
     *
     * @param options - Optional port override (defaults to `config.port`).
     * @returns Resolves once the server has been torn down.
     * @example
     * await api.serve({ port: 3000 });
     */
    serve(options = {}) {
      const { port = ctx.config.port } = options;
      ctx.state.render.header("serve");
      return runDevServer(ctx, port);
    },

    /**
     * Static preview of the built `dist/` with CF-Pages clean-URL resolution.
     *
     * @param options - Optional port override (defaults to `config.port`).
     * @returns Resolves once the server has been torn down.
     * @example
     * await api.preview();
     */
    preview(options = {}) {
      const { port = ctx.config.port } = options;
      ctx.state.render.header("preview");
      return runPreviewServer(ctx, port);
    },

    /**
     * Scaffold, then deploy. A y/N confirm is shown only when a human is present (an
     * interactive TTY, with `CI` unset). Non-interactive runs (CI, or any non-TTY)
     * skip the prompt and deploy, so the consumer scripts never hang a pipeline.
     * `options.yes` forces the skip anywhere. An interactive "no" returns
     * `{ deployed: false, reason: "declined" }`.
     *
     * @param options - Optional branch override and `yes` flag.
     * @returns The deploy outcome (completed details, or `declined` if a TTY user says no).
     * @example
     * await api.deploy({ branch: "preview/x", yes: true });
     */
    async deploy(options = {}) {
      const { branch, yes = false } = options;

      // Render the command header, then scaffold the deploy (CI mode).
      ctx.state.render.header("deploy");
      await ctx.require(deployPlugin).init({ ci: true });

      // Gate on confirmation; an interactive "no" returns without deploying.
      if (!(await confirmDeploy(ctx, yes))) {
        return { deployed: false, reason: "declined" };
      }

      // Proceed: deploy (progress arrives via hooks) and report the outcome.
      const result = await ctx.require(deployPlugin).run(branch === undefined ? {} : { branch });
      return { deployed: true, ...result };
    }
  };
}
