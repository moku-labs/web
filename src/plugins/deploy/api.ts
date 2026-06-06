/**
 * @file deploy plugin — API factory (run + getLastDeployment + init), the
 * deploy plugin context type, and onInit config validation.
 */
import type { EmitFn } from "@moku-labs/core";
import { sitePlugin } from "../site";
import { writeScaffolding } from "./init";
import { runPreflight } from "./preflight";
import { toSlug } from "./slug";
import type { Api, Config, CreateProjectResult, DeployResult, State } from "./types";
import {
  buildProjectCreateArgs,
  buildWranglerArgs,
  classifyWranglerError,
  deployError,
  parseDeploymentId,
  parseDeployUrl,
  runWrangler
} from "./wrangler";

/** Error prefix for deploy config/validation failures (spec/11 Part-3). */
const ERROR_PREFIX = "[web] deploy";

/** `YYYY-MM-DD` validator for the compatibility date config field. */
const COMPAT_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Structural extraction of a plugin instance's public API from its `_phantom`
 * carrier (mirrors the kernel's non-exported `ExtractPluginApi`) so the
 * framework's generic `require` is assignable to {@link DeployRequire}.
 *
 * @example
 * type SiteApi = ExtractApi<typeof sitePlugin>;
 */
export type ExtractApi<PluginCandidate> = PluginCandidate extends {
  readonly _phantom: { readonly api: infer PluginApi };
}
  ? PluginApi
  : never;

/** Generic `require` closure for pulling a dependency plugin's API at run time. */
export type DeployRequire = <
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

/** Minimal logger slice the deploy plugin consumes (the core `log` API). */
export type DeployLog = {
  /** Record an informational event. */
  info(event: string, data?: unknown): void;
};

/** Minimal env slice the deploy plugin consumes (the core `env` API). */
export type DeployEnv = {
  /** Read a variable that must exist (throws otherwise). */
  require(key: string): string;
};

/** Payload map for the events `deploy` emits, used to type the `emit` closure. */
export type DeployEvents = {
  /** One successful-deploy summary (notification-only). */
  "deploy:complete": { url: string; deploymentId: string; branch: string; durationMs: number };
};

/** Strictly-typed emit closure for the deploy events (kernel overload form). */
export type DeployEmit = EmitFn<DeployEvents>;

/**
 * The plugin-context slice the deploy API and `onInit` consume: the mutable
 * `state`, the resolved `config`, plus `require`/`emit`/`log`/`env`. Typed to
 * match the kernel's generic context so the framework execution context is
 * structurally assignable.
 *
 * @example
 * const ctx: DeployPluginContext = { state, config, require, emit, log, env };
 */
export type DeployPluginContext = {
  /** Mutable deploy state (lastDeployment + injectable spawn). */
  state: State;
  /** Resolved, frozen deploy config. */
  readonly config: Readonly<Config>;
  /** Resolve a depended-upon plugin instance to its public API. */
  require: DeployRequire;
  /** Emit a deploy event (notification-only). */
  emit: DeployEmit;
  /** Structured logger (core `log` API). */
  readonly log: DeployLog;
  /** Environment accessor (core `env` API). */
  readonly env: DeployEnv;
};

/**
 * Validate the resolved deploy config during `onInit` (config-only, no resource
 * allocation) and resolve the `site` dependency for later slug derivation. Throws
 * `ERR_DEPLOY_CONFIG` on a bad target/outDir/scrubAllowlist/compatibilityDate.
 *
 * @param ctx - Plugin context exposing the resolved config and `require`.
 * @throws {Error} `ERR_DEPLOY_CONFIG` when any config field is invalid.
 * @example
 * createPlugin("deploy", { onInit: validateConfig });
 */
export function validateConfig(ctx: DeployPluginContext): void {
  const { config } = ctx;

  // Reject any deploy target other than the one this version supports.
  if (config.target !== "cloudflare-pages") {
    throw deployError(
      "ERR_DEPLOY_CONFIG",
      `${ERROR_PREFIX}: target ${JSON.stringify(config.target)} is unsupported.\n  Only "cloudflare-pages" is supported in this version.`
    );
  }

  // The build output directory must name a real, non-empty path.
  const hasUsableOutDir = typeof config.outDir === "string" && config.outDir.length > 0;
  if (!hasUsableOutDir) {
    throw deployError(
      "ERR_DEPLOY_CONFIG",
      `${ERROR_PREFIX}: outDir must be a non-empty string.\n  Set pluginConfigs.deploy.outDir to your build output directory (e.g. "dist").`
    );
  }

  // The scrub allowlist must be a homogeneous string array.
  const isStringArray =
    Array.isArray(config.scrubAllowlist) &&
    config.scrubAllowlist.every(item => typeof item === "string");
  if (!isStringArray) {
    throw deployError(
      "ERR_DEPLOY_CONFIG",
      `${ERROR_PREFIX}: scrubAllowlist must be an array of strings.`
    );
  }

  // When supplied, the compatibility date must be a YYYY-MM-DD calendar string.
  const hasMalformedCompatDate =
    config.compatibilityDate !== undefined && !COMPAT_DATE_REGEX.test(config.compatibilityDate);
  if (hasMalformedCompatDate) {
    throw deployError(
      "ERR_DEPLOY_CONFIG",
      `${ERROR_PREFIX}: compatibilityDate ${JSON.stringify(config.compatibilityDate)} must be in YYYY-MM-DD form.`
    );
  }

  // Ensure the site dependency resolves (slug is derived from site.name()).
  ctx.require(sitePlugin);
}

/**
 * Run wrangler for the prepared argv and surface its scrubbed result, translating
 * a non-zero exit into the classified deploy error. The API token is read from env
 * here so it never crosses a logging boundary; only scrubbed output is returned.
 * Shared by `run()` (deploy) and `createProject()` (project create).
 *
 * @param ctx - Plugin context (provides `state.spawn`, `config`, `env`).
 * @param args - The fully-built, pre-validated wrangler argv.
 * @returns The wrangler `stdout` plus the scrubbed `stderr` to log on success.
 * @throws {Error} With a `code` from the deploy error taxonomy on a non-zero exit.
 * @example
 * const { stdout, scrubbedStderr } = await executeWrangler(ctx, args);
 */
async function executeWrangler(
  ctx: DeployPluginContext,
  args: string[]
): Promise<{ stdout: string; scrubbedStderr: string }> {
  const token = ctx.env.require("CLOUDFLARE_API_TOKEN"); // never logged
  const { stdout, scrubbedStderr, exitCode } = await runWrangler({
    spawn: ctx.state.spawn,
    args,
    token,
    allowlist: ctx.config.scrubAllowlist
  });

  if (exitCode !== 0) {
    const { code, message } = classifyWranglerError(exitCode, scrubbedStderr);
    throw deployError(code, message);
  }

  return { stdout, scrubbedStderr };
}

/**
 * Assemble the public {@link DeployResult} from wrangler's stdout, parsing the
 * deployed URL and deployment id and stamping the elapsed wall-clock duration.
 *
 * @param stdout - The wrangler `stdout` carrying the URL + deployment id.
 * @param branch - The branch the deploy targeted.
 * @param startedAt - The `Date.now()` timestamp captured before the subprocess ran.
 * @returns The fully-populated deploy result.
 * @example
 * const result = buildDeployResult(stdout, "main", start);
 */
function buildDeployResult(stdout: string, branch: string, startedAt: number): DeployResult {
  return {
    url: parseDeployUrl(stdout),
    deploymentId: parseDeploymentId(stdout),
    branch,
    durationMs: Date.now() - startedAt
  };
}

/**
 * Creates the deploy plugin API surface (`run`, `getLastDeployment`, `init`). The
 * API closures are wiring-thin: `run` derives the slug from `site.name()`, guards
 * the branch + outDir, runs preflight, spawns wrangler via the injectable spawner
 * (scrubbing all output before logging), records `lastDeployment`, and emits
 * `deploy:complete` only on success.
 *
 * @param ctx - Plugin context (provides `require`, `emit`, `state`, `config`, `log`, `env`).
 * @returns The {@link Api} surface mounted at `app.deploy`.
 * @example
 * const api = createApi(ctx);
 * await api.run({ branch: "preview/landing" });
 */
export function createApi(ctx: DeployPluginContext): Api {
  return {
    /**
     * Deploy the built outDir to Cloudflare Pages via the wrangler subprocess.
     *
     * @param options - Optional branch override.
     * @returns The deploy result (url, deploymentId, branch, durationMs).
     * @throws {Error} With a `code` from the deploy error taxonomy on any failure.
     * @example
     * await api.run();
     */
    async run(options = {}) {
      // Derive the deploy inputs: project root, site-derived slug, target branch.
      const root = process.cwd();
      const slug = toSlug(ctx.require(sitePlugin).name());
      const branch = options.branch ?? ctx.config.productionBranch ?? "main";

      // Preflight (cheap → expensive), then build the guarded, validated argv.
      await runPreflight(ctx.config, root);
      const args = buildWranglerArgs({ outDir: ctx.config.outDir, slug, branch, root });

      // Spawn wrangler and capture its scrubbed output (throws on a failed deploy).
      const start = Date.now();
      const { stdout, scrubbedStderr } = await executeWrangler(ctx, args);
      ctx.log.info(scrubbedStderr); // only scrubbed* values reach ctx.log

      // Record the result as lastDeployment and announce it, then return it.
      const result = buildDeployResult(stdout, branch, start);
      ctx.state.lastDeployment = result;
      ctx.emit("deploy:complete", {
        url: result.url,
        deploymentId: result.deploymentId,
        branch: result.branch,
        durationMs: result.durationMs
      });
      return result;
    },

    /**
     * Return the most recent successful deploy result, or null if none occurred.
     *
     * @returns A frozen snapshot of the last DeployResult, or null.
     * @example
     * const last = api.getLastDeployment();
     */
    getLastDeployment() {
      const last = ctx.state.lastDeployment;
      // eslint-disable-next-line unicorn/no-null -- API contract returns null when none.
      return last ? Object.freeze({ ...last }) : null;
    },

    /**
     * Generate deploy scaffolding (wrangler.jsonc + optional GitHub workflow).
     *
     * @param options - Optional ci toggle and check (drift-only) mode.
     * @returns Which files were written, skipped, or would drift.
     * @example
     * await api.init({ ci: true });
     */
    async init(options = {}) {
      const slug = toSlug(ctx.require(sitePlugin).name());
      return writeScaffolding({ config: ctx.config, slug, cwd: process.cwd(), options });
    },

    /**
     * The Cloudflare Pages project name this app deploys to (`toSlug(site.name())`).
     *
     * @returns The project-name slug.
     * @example
     * api.projectName(); // "my-site"
     */
    projectName() {
      return toSlug(ctx.require(sitePlugin).name());
    },

    /**
     * Create the remote Cloudflare Pages project via wrangler, so a first deploy has a
     * target. Derives the slug from `site.name()` and the production branch from config.
     *
     * @returns The created project name + production branch.
     * @throws {Error} With a `code` from the deploy error taxonomy on a non-zero exit.
     * @example
     * await api.createProject(); // { name: "my-site", branch: "main" }
     */
    async createProject(): Promise<CreateProjectResult> {
      // Derive the same slug run() deploys to, and the production branch to seed.
      const name = toSlug(ctx.require(sitePlugin).name());
      const branch = ctx.config.productionBranch ?? "main";

      // Build the guarded argv, spawn wrangler (scrubbed; throws on a non-zero exit).
      const args = buildProjectCreateArgs({ slug: name, branch });
      const { scrubbedStderr } = await executeWrangler(ctx, args);
      ctx.log.info(scrubbedStderr); // only scrubbed* values reach ctx.log

      return { name, branch };
    }
  };
}
