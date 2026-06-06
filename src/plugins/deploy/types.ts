/**
 * @file deploy plugin — type definitions.
 */
import type { WorkflowTrigger } from "./generators/github-workflow";

export type { WorkflowTrigger } from "./generators/github-workflow";

/**
 * Options passed to the injected spawner — the subset of Bun.spawn's options the
 * plugin uses (piped stdout/stderr plus an env carrying the API token).
 */
export interface SpawnOptions {
  /** Capture stdout as a readable stream. */
  readonly stdout: "pipe";
  /** Capture stderr as a readable stream. */
  readonly stderr: "pipe";
  /** Subprocess environment — the API token is injected here, never via argv. */
  readonly env?: Record<string, string | undefined>;
}

/**
 * The structural subprocess handle the plugin reads back: stdout/stderr streams
 * plus the exit-code promise. Streams are typed `unknown` and narrowed at the read
 * site so this carries no Bun namespace types.
 */
export interface SpawnedProcess {
  /** Standard output stream (narrowed to a ReadableStream at the read site). */
  readonly stdout: unknown;
  /** Standard error stream (narrowed to a ReadableStream at the read site). */
  readonly stderr: unknown;
  /** Resolves with the subprocess exit code. */
  readonly exited: Promise<number>;
}

/**
 * The subset of Bun.spawn's signature the plugin relies on (argv array + options).
 * Declared structurally — with NO `import("bun")` namespace types — so it survives
 * `.d.ts` bundling intact and tests can supply a fake spawn without importing Bun.
 */
export type SpawnFunction = (cmd: string[], options: SpawnOptions) => SpawnedProcess;

/**
 * A deploy error `code` from the wrangler error taxonomy and preflight validators.
 */
export type DeployErrorCode =
  | "ERR_DEPLOY_NO_WRANGLER_CONFIG"
  | "ERR_DEPLOY_EMPTY_OUTDIR"
  | "ERR_DEPLOY_TOO_MANY_FILES"
  | "ERR_DEPLOY_FILE_TOO_LARGE"
  | "ERR_DEPLOY_PATH_TRAVERSAL"
  | "ERR_DEPLOY_INVALID_BRANCH"
  | "ERR_DEPLOY_NO_TOKEN"
  | "ERR_DEPLOY_PROJECT_NOT_FOUND"
  | "ERR_DEPLOY_AUTH_EXPIRED"
  | "ERR_DEPLOY_AUTH"
  | "ERR_DEPLOY_NETWORK"
  | "ERR_DEPLOY_WRANGLER_FAILED"
  | "ERR_DEPLOY_CONFIG";

/**
 * The subset of wrangler error `code`s classifyWranglerError can produce from a
 * non-zero wrangler exit.
 */
export type WranglerErrorKind = Extract<
  DeployErrorCode,
  | "ERR_DEPLOY_PROJECT_NOT_FOUND"
  | "ERR_DEPLOY_AUTH_EXPIRED"
  | "ERR_DEPLOY_AUTH"
  | "ERR_DEPLOY_NETWORK"
  | "ERR_DEPLOY_WRANGLER_FAILED"
>;

/**
 * Configuration for the deploy plugin.
 */
export type Config = {
  /**
   * Deploy target. Only Cloudflare Pages is supported in this version.
   * Defaults to `cloudflare-pages`.
   */
  target: "cloudflare-pages";
  /**
   * Directory (relative to project root) containing the built site to deploy.
   * Re-validated against cwd at run() time to block path traversal.
   * Defaults to `dist`.
   */
  outDir: string;
  /**
   * Branch treated as the Cloudflare Pages production branch.
   * Defaults to `main`.
   */
  productionBranch?: string;
  /**
   * Substrings exempt from entropy-gated secret scrubbing in logged output.
   * Defaults to `["CLOUDFLARE_ACCOUNT_ID"]`.
   */
  scrubAllowlist: string[];
  /**
   * Cloudflare compatibility date written into generated wrangler.jsonc.
   * Defaults to `2024-01-01`.
   */
  compatibilityDate?: string;
  /**
   * Whether init() also generates a GitHub Actions workflow.
   * Defaults to `false`.
   */
  ci?: boolean;
};

/**
 * Result of a successful deploy.
 */
export type DeployResult = {
  /** The public deployment URL (e.g. https://my-site.pages.dev). */
  url: string;
  /** Cloudflare deployment ID parsed from wrangler output. */
  deploymentId: string;
  /** The branch that was deployed. */
  branch: string;
  /** Wall-clock duration of the deploy in milliseconds. */
  durationMs: number;
};

/**
 * Runtime state for the deploy plugin. Created in createState() and accessed via
 * ctx.state. deploy declares no onStop because nothing here is a long-lived resource.
 */
export type State = {
  /** Result of the most recent successful deploy, or null before the first run. */
  lastDeployment: DeployResult | null;
  /**
   * Injectable subprocess spawner. Defaults to Bun.spawn. Swapped for a mock in
   * unit tests so wrangler is never actually invoked. Never reassigned at runtime.
   */
  spawn: SpawnFunction;
};

/**
 * Options for DeployApi.run.
 */
export type DeployRunOptions = {
  /**
   * Branch to deploy. Defaults to config.productionBranch (or "main"). Must match
   * /^[a-zA-Z0-9/_.-]+$/ — otherwise rejected with ERR_DEPLOY_INVALID_BRANCH.
   */
  branch?: string;
};

/**
 * Options for DeployApi.init.
 */
export type DeployInitOptions = {
  /** Also generate the GitHub Actions workflow. Defaults to config.ci. */
  ci?: boolean;
  /** Drift-only mode: report differences without writing any files. Defaults to `false`. */
  check?: boolean;
  /**
   * What triggers the generated workflow (see {@link WorkflowTrigger}): `"auto"` (push to
   * main), `"versioned-tag"` (push a `v*` tag), or `"dispatch"` (manual only). Default `"auto"`.
   */
  workflowTrigger?: WorkflowTrigger;
};

/**
 * Result of an init/scaffold operation.
 */
export type InitResult = {
  /** Paths written this invocation. */
  written: string[];
  /** Paths skipped because they already exist. */
  skipped: string[];
  /** In check mode: paths whose on-disk content differs from what would be generated. */
  drifted: string[];
};

/**
 * Public API of the deploy plugin (returned from the api factory).
 */
export type Api = {
  /**
   * Deploy the built outDir to Cloudflare Pages via the wrangler subprocess.
   * Runs preflight validators, re-validates the resolved outdir against cwd, guards
   * the branch argument, spawns wrangler (no shell), scrubs all subprocess output
   * before logging, records lastDeployment, and emits deploy:complete.
   *
   * @param options - Optional branch override.
   * @returns The deploy result (url, deploymentId, branch, durationMs).
   * @throws {Error} With a `code` from the deploy error taxonomy on any failure.
   * @example
   * const result = await app.deploy.run();
   * console.log(result.url); // https://my-site.pages.dev
   * @example
   * await app.deploy.run({ branch: "preview/landing" });
   */
  run(options?: DeployRunOptions): Promise<DeployResult>;
  /**
   * Return the most recent successful deploy result, or null if none has occurred.
   * The returned object is read-only (a defensive snapshot).
   *
   * @returns The last DeployResult, or null.
   * @example
   * const last = app.deploy.getLastDeployment();
   * if (last) console.log(`Last deployed to ${last.url}`);
   */
  getLastDeployment(): Readonly<DeployResult> | null;
  /**
   * Generate deploy scaffolding: wrangler.jsonc (slug from site.name() + outDir +
   * compatibilityDate) and, when ci is enabled, .github/workflows/deploy.yml. Never
   * overwrites an existing wrangler.jsonc. In check mode, reports drift instead of writing.
   *
   * @param options - Optional ci toggle and check (drift-only) mode.
   * @returns Which files were written, skipped, or would drift.
   * @example
   * const out = await app.deploy.init({ ci: true });
   * // out.written -> ["wrangler.jsonc", ".github/workflows/deploy.yml"]
   * @example
   * const drift = await app.deploy.init({ check: true });
   * if (drift.drifted.length) process.exit(1);
   */
  init(options?: DeployInitOptions): Promise<InitResult>;
};
