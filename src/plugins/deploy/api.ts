/**
 * @file deploy plugin — API factory (run + getLastDeployment + init), the
 * deploy plugin context type, and onInit config validation.
 */
import type { EmitFn } from "@moku-labs/core";
import { sitePlugin } from "../site";
import { writeScaffolding } from "./init";
import { runPreflight } from "./preflight";
import { toSlug } from "./slug";
import type { Api, Config, DeployResult, State } from "./types";
import {
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
  if (config.target !== "cloudflare-pages") {
    throw deployError(
      "ERR_DEPLOY_CONFIG",
      `${ERROR_PREFIX}: target ${JSON.stringify(config.target)} is unsupported.\n  Only "cloudflare-pages" is supported in this version.`
    );
  }
  if (typeof config.outDir !== "string" || config.outDir.length === 0) {
    throw deployError(
      "ERR_DEPLOY_CONFIG",
      `${ERROR_PREFIX}: outDir must be a non-empty string.\n  Set pluginConfigs.deploy.outDir to your build output directory (e.g. "dist").`
    );
  }
  if (
    !Array.isArray(config.scrubAllowlist) ||
    !config.scrubAllowlist.every(item => typeof item === "string")
  ) {
    throw deployError(
      "ERR_DEPLOY_CONFIG",
      `${ERROR_PREFIX}: scrubAllowlist must be an array of strings.`
    );
  }
  if (config.compatibilityDate !== undefined && !COMPAT_DATE_REGEX.test(config.compatibilityDate)) {
    throw deployError(
      "ERR_DEPLOY_CONFIG",
      `${ERROR_PREFIX}: compatibilityDate ${JSON.stringify(config.compatibilityDate)} must be in YYYY-MM-DD form.`
    );
  }
  // Ensure the site dependency resolves (slug is derived from site.name()).
  ctx.require(sitePlugin);
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
     * @param options - Optional branch override and build toggle.
     * @returns The deploy result (url, deploymentId, branch, durationMs).
     * @throws {Error} With a `code` from the deploy error taxonomy on any failure.
     * @example
     * await api.run();
     */
    async run(options = {}) {
      const root = process.cwd();
      const slug = toSlug(ctx.require(sitePlugin).name());
      const branch = options.branch ?? ctx.config.productionBranch ?? "main";

      // Preflight (cheap → expensive) before any subprocess work.
      await runPreflight(ctx.config, root);
      // Branch guard + path-traversal re-validation, baked into the argv builder.
      const args = buildWranglerArgs({ outDir: ctx.config.outDir, slug, branch, root });

      const token = ctx.env.require("CLOUDFLARE_API_TOKEN"); // never logged
      const start = Date.now();
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
      // Only scrubbed* values reach ctx.log.
      ctx.log.info(scrubbedStderr);

      const result: DeployResult = {
        url: parseDeployUrl(stdout),
        deploymentId: parseDeploymentId(stdout),
        branch,
        durationMs: Date.now() - start
      };
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
    }
  };
}
