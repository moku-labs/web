/**
 * @file cli plugin — the guided deploy wizard (`cli.deploy({ guided: true })`, the default
 * for `bun run deploy`; the direct `--cli` path stays in `api.ts`). Walks a human through a
 * Cloudflare Pages deploy: checks prerequisites (wrangler config + the Cloudflare
 * credentials) with concrete fix guidance, offers to scaffold what is missing (a
 * `wrangler.jsonc`, and a placeholder `.env` for any missing credentials), HARD-GATES the
 * deploy on everything being green, runs a local build smoke test, confirms, deploys, then
 * offers to scaffold a GitHub Actions workflow (auto on push to main, or a versioned/manual
 * trigger). Every prompt + line of output flows through injectable `state` seams.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildPlugin } from "../build";
import { deployPlugin } from "../deploy";
import type { WorkflowTrigger } from "../deploy/types";
import type { CliPluginContext } from "./api";
import type { DeployOptions, DeployOutcome } from "./types";

/** How to create a Cloudflare API token + where to make it available locally. */
const TOKEN_HELP = [
  "Create one at https://dash.cloudflare.com/profile/api-tokens → Create Token →",
  'use the "Cloudflare Pages — Edit" template (or a custom token with the',
  "Account › Cloudflare Pages › Edit permission). Then make it available:",
  "  export CLOUDFLARE_API_TOKEN=…   (shell)   or add it to .env (gitignored)."
].join("\n");

/** Where to find the Cloudflare account id + where to make it available locally. */
const ACCOUNT_HELP = [
  "Find it on the Cloudflare dashboard → Workers & Pages: the Account ID is in the",
  "right-hand sidebar (also in the dashboard URL). Then make it available:",
  "  export CLOUDFLARE_ACCOUNT_ID=…   or add it to .env."
].join("\n");

/** Shown when a credential is in the raw environment but the app's env providers did not resolve it. */
const PROVIDERS_HELP = [
  "Found in your shell/.env but the app's env plugin did not resolve it — its providers",
  "are not wired. Add the Node providers in createApp so the deploy can read it:",
  "  pluginConfigs.env = { providers: [processEnv(), dotenv()] }   (import them from @moku-labs/web)."
].join("\n");

/** The GitHub repo secrets the generated workflow consumes. */
const SECRETS_HELP = [
  "Add these repo secrets (GitHub → Settings → Secrets and variables → Actions):",
  "CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID"
].join("\n");

/** One prerequisite check: its result, whether it blocks the deploy, and a fix hint. */
type Prerequisite = {
  /** Whether the prerequisite is satisfied. */
  ok: boolean;
  /** The label shown on the diagnostic line. */
  label: string;
  /** Fix guidance shown (dimmed) when the check fails. */
  detail: string | undefined;
  /** Whether `wrangler.jsonc` scaffolding can auto-fix this (the only fixable prereq). */
  scaffoldable: boolean;
};

/**
 * Build one credential prerequisite by reading the SAME source the deploy reads — the
 * resolved `ctx.env` table — so a ✓ guarantees `ctx.env.require(key)` will succeed. When
 * the value is present in the raw `process.env` but unresolved by the app's providers
 * (the silent "deploy can't see it" trap a bare `process.env` check would mark green),
 * the fix hint points at wiring the providers instead of re-adding the value.
 *
 * @param ctx - The cli plugin context (provides the resolved `ctx.env`).
 * @param key - The credential variable name.
 * @param label - The diagnostic line label.
 * @param missingHelp - The fix hint when the credential is genuinely absent everywhere.
 * @returns The credential prerequisite check.
 * @example
 * credentialPrereq(ctx, "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_TOKEN is set", TOKEN_HELP);
 */
function credentialPrereq(
  ctx: CliPluginContext,
  key: string,
  label: string,
  missingHelp: string
): Prerequisite {
  // Check what the deploy will actually read (the resolved env), never raw process.env.
  const resolvedOk = (ctx.env.get(key) ?? "") !== "";
  if (resolvedOk) return { ok: true, label, detail: undefined, scaffoldable: false };

  // Unresolved: pick the hint by failure mode — present in the raw env but unsurfaced by
  // the app's providers (wired-but-unresolved trap) vs genuinely absent everywhere.
  const inRawEnv = (process.env[key] ?? "") !== "";
  const detail = inRawEnv ? PROVIDERS_HELP : missingHelp;
  return { ok: false, label, detail, scaffoldable: false };
}

/**
 * Evaluate the three deploy prerequisites against the current project: the Cloudflare
 * wrangler config exists, and both Cloudflare credentials resolve through `ctx.env` (the
 * deploy's own source of truth — not a bare `process.env` read that can diverge from it).
 *
 * @param ctx - The cli plugin context (provides the resolved `ctx.env`).
 * @param cwd - The project root (where `wrangler.jsonc` lives).
 * @returns The ordered prerequisite checks.
 * @example
 * const prereqs = diagnose(ctx, process.cwd());
 */
function diagnose(ctx: CliPluginContext, cwd: string): Prerequisite[] {
  const wranglerOk = existsSync(path.join(cwd, "wrangler.jsonc"));
  return [
    {
      ok: wranglerOk,
      label: "wrangler.jsonc (Cloudflare project config)",
      detail: wranglerOk
        ? undefined
        : "Missing — scaffold it (offered below) or run app.deploy.init().",
      scaffoldable: true
    },
    credentialPrereq(ctx, "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_TOKEN is set", TOKEN_HELP),
    credentialPrereq(ctx, "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID is set", ACCOUNT_HELP)
  ];
}

/**
 * Offer to scaffold a missing `wrangler.jsonc` (the only auto-fixable prerequisite),
 * generating it via the deploy plugin when the user accepts.
 *
 * @param ctx - The cli plugin context.
 * @param prereqs - The current prerequisite checks.
 * @returns Resolves once any accepted fix has run.
 * @example
 * await offerScaffold(ctx, diagnose(cwd));
 */
async function offerScaffold(ctx: CliPluginContext, prereqs: Prerequisite[]): Promise<void> {
  const needsScaffold = prereqs.some(item => item.scaffoldable && !item.ok);
  if (!needsScaffold) return;
  if (!(await ctx.state.confirm("Scaffold wrangler.jsonc now?"))) return;
  await ctx.require(deployPlugin).init({});
  ctx.state.render.check(true, "wrangler.jsonc scaffolded");
}

/** The Cloudflare credentials the deploy needs, with the comment written above each in a scaffolded `.env`. */
const ENV_CREDENTIALS = [
  {
    key: "CLOUDFLARE_API_TOKEN",
    comment:
      "# Cloudflare API token — https://dash.cloudflare.com/profile/api-tokens (template: Cloudflare Pages — Edit)"
  },
  {
    key: "CLOUDFLARE_ACCOUNT_ID",
    comment: "# Cloudflare account id — dashboard → Workers & Pages → right-hand sidebar"
  }
] as const;

/**
 * Offer to scaffold a `.env` with placeholders for whichever Cloudflare credentials are
 * missing — created when absent, appended to (never clobbering a key already present)
 * when it exists. The placeholders are empty, so the deploy still hard-gates until the
 * user fills them in; this just removes the "where do I even put these?" friction.
 *
 * @param ctx - The cli plugin context.
 * @param cwd - The project root (where `.env` lives).
 * @returns Resolves once any accepted scaffold has been written.
 * @example
 * await offerEnvScaffold(ctx, process.cwd());
 */
async function offerEnvScaffold(ctx: CliPluginContext, cwd: string): Promise<void> {
  const missing = ENV_CREDENTIALS.filter(({ key }) => (process.env[key] ?? "") === "");
  if (missing.length === 0) return;

  const envPath = path.join(cwd, ".env");
  const exists = existsSync(envPath);
  const verb = exists ? "Add placeholders for the missing secret(s) to" : "Create";
  if (!(await ctx.state.confirm(`${verb} .env?`))) return;

  // Never overwrite a key already present in an existing .env — only add the ones it lacks.
  const lines = exists ? readFileSync(envPath, "utf8").split(/\r?\n/) : [];
  const toAdd = missing.filter(
    ({ key }) => !lines.some(line => line.trimStart().startsWith(`${key}=`))
  );
  if (toAdd.length === 0) {
    ctx.state.render.info(".env already lists those keys — fill in their values, then re-run.");
    return;
  }

  const header = exists
    ? "\n"
    : "# Cloudflare Pages deploy credentials — fill these in (keep .env gitignored).\n";
  const block = toAdd.map(({ key, comment }) => `${comment}\n${key}=`).join("\n\n");
  appendFileSync(envPath, `${header}${block}\n`);

  const names = toAdd.map(({ key }) => key).join(", ");
  ctx.state.render.check(
    true,
    `${exists ? "added placeholders to" : "created"} .env`,
    `fill in ${names}, then re-run \`bun run deploy\`.`
  );
}

/**
 * Map a top-level workflow choice (and, for the versioned option, a sub-choice) to the
 * concrete {@link WorkflowTrigger}, or `null` when the user chose to skip setup.
 *
 * @param ctx - The cli plugin context (for the follow-up sub-choice prompt).
 * @param choice - The selected zero-based index of the top-level options.
 * @returns The resolved trigger, or `null` to skip.
 * @example
 * const trigger = await resolveTrigger(ctx, 1);
 */
async function resolveTrigger(
  ctx: CliPluginContext,
  choice: number
): Promise<WorkflowTrigger | null> {
  // 0 = auto on push to main, 1 = manual/versioned (ask how), 2 = skip.
  if (choice === 2) {
    // eslint-disable-next-line unicorn/no-null -- null signals "skip workflow setup".
    return null;
  }
  if (choice === 0) return "auto";
  const sub = await ctx.state.select("How should the versioned deploy be triggered?", [
    "On a version tag push (v*) + the manual Run-workflow button",
    "Manual Run-workflow button only (workflow_dispatch)"
  ]);
  return sub === 0 ? "versioned-tag" : "dispatch";
}

/**
 * Offer to scaffold a GitHub Actions deploy workflow, letting the user choose how it is
 * triggered, then remind them which repo secrets to add. A no-op past a "skip" choice.
 *
 * @param ctx - The cli plugin context.
 * @returns Resolves once any chosen workflow has been scaffolded.
 * @example
 * await offerWorkflowSetup(ctx);
 */
async function offerWorkflowSetup(ctx: CliPluginContext): Promise<void> {
  ctx.state.render.heading("Automate future deploys (GitHub Actions)");
  const choice = await ctx.state.select("Set up a deploy workflow?", [
    "Auto-deploy on every push to main",
    "Manual / versioned deploy (choose trigger)",
    "Skip for now"
  ]);
  const trigger = await resolveTrigger(ctx, choice);
  if (trigger === null) return;

  const result = await ctx.require(deployPlugin).init({ ci: true, workflowTrigger: trigger });
  const workflowPath = ".github/workflows/deploy.yml";
  const wrote = result.written.includes(workflowPath);
  ctx.state.render.check(
    true,
    wrote ? `wrote ${workflowPath}` : `${workflowPath} already exists (left unchanged)`
  );
  ctx.state.render.info(SECRETS_HELP);
}

/**
 * Read the taxonomy `code` off a thrown value, when present. Deploy errors carry a
 * `code` (e.g. `ERR_DEPLOY_PROJECT_NOT_FOUND`) so the wizard can tailor the fix hint.
 *
 * @param error - The thrown value.
 * @returns The `code` string, or `undefined` when absent.
 * @example
 * codeOf(deployError("ERR_DEPLOY_AUTH", "…")); // "ERR_DEPLOY_AUTH"
 */
function codeOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code?: unknown };
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * A copy-pasteable "create the project yourself" hint, shown when the user declines the
 * offer to auto-create. Spells out that the remote project is what's missing (init only
 * scaffolds local config).
 *
 * @param name - The Cloudflare Pages project name (the deploy slug).
 * @returns The multi-line hint (newline-separated; rendered indented under a `›`).
 * @example
 * ctx.state.render.info(projectNotFoundHint("my-site"));
 */
function projectNotFoundHint(name: string): string {
  return [
    "how to fix: the Cloudflare Pages project does not exist yet — create it once, then",
    "re-run `bun run deploy`. (app.deploy.init() only scaffolds local config; it does not",
    "create the remote project.)",
    `  • CLI:       bunx wrangler pages project create ${name} --production-branch main`,
    "  • Dashboard: Cloudflare → Workers & Pages → Create → Pages"
  ].join("\n");
}

/**
 * An actionable, error-specific "how to fix" hint for a failed deploy (other than the
 * project-not-found case, which the wizard handles interactively), so the user never
 * lands on a raw stack trace.
 *
 * @param error - The thrown deploy error.
 * @returns The fix hint line.
 * @example
 * ctx.state.render.info(deployFailureHint(err));
 */
function deployFailureHint(error: unknown): string {
  const code = codeOf(error);

  // A reached-Cloudflare auth failure (token present but rejected/expired).
  if (code === "ERR_DEPLOY_AUTH" || code === "ERR_DEPLOY_AUTH_EXPIRED") {
    return "how to fix: refresh CLOUDFLARE_API_TOKEN (scope: Account › Cloudflare Pages › Edit), then re-run `bun run deploy`.";
  }

  // A transport failure on the way to Cloudflare.
  if (code === "ERR_DEPLOY_NETWORK") {
    return "how to fix: a network error reached Cloudflare — check connectivity, then re-run `bun run deploy`.";
  }

  return "how to fix: resolve the error above, then re-run `bun run deploy`.";
}

/**
 * Render a styled deploy failure (✗ + fix hint) and return the `"failed"` outcome, so a
 * caught error surfaces consistently instead of as a raw throw.
 *
 * @param ctx - The cli plugin context.
 * @param error - The thrown deploy error.
 * @returns The `"failed"` deploy outcome.
 * @example
 * return renderFailure(ctx, error);
 */
function renderFailure(ctx: CliPluginContext, error: unknown): DeployOutcome {
  ctx.state.render.error("deploy failed", error);
  ctx.state.render.info(deployFailureHint(error));
  return { deployed: false, reason: "failed" };
}

/**
 * Deploy once via the deploy plugin and wrap the result as a successful outcome. Throws
 * the classified deploy error on failure (the caller decides how to surface it).
 *
 * @param ctx - The cli plugin context.
 * @param options - The deploy options (branch override).
 * @returns The successful deploy outcome.
 * @throws {Error} With a `code` from the deploy error taxonomy on any failure.
 * @example
 * const outcome = await deployOnce(ctx, { branch: "main" });
 */
async function deployOnce(ctx: CliPluginContext, options: DeployOptions): Promise<DeployOutcome> {
  const result = await ctx
    .require(deployPlugin)
    .run(options.branch === undefined ? {} : { branch: options.branch });
  return { deployed: true, ...result };
}

/**
 * Handle a project-not-found deploy failure interactively: ask (a confirmation step)
 * before creating a real Cloudflare resource, create the Pages project via the deploy
 * plugin, then retry the deploy once. A declined offer (or a create failure) returns the
 * `"failed"` outcome with an actionable hint — never a raw stack trace.
 *
 * @param ctx - The cli plugin context.
 * @param options - The deploy options (branch override).
 * @param originalError - The project-not-found error from the first attempt.
 * @returns The deploy outcome (deployed after a successful create + retry, else failed).
 * @example
 * return createProjectThenRetry(ctx, options, error);
 */
async function createProjectThenRetry(
  ctx: CliPluginContext,
  options: DeployOptions,
  originalError: unknown
): Promise<DeployOutcome> {
  const deploy = ctx.require(deployPlugin);
  const name = deploy.projectName();

  // Confirmation step — never create a remote resource without an explicit yes.
  ctx.state.render.warn(`The Cloudflare Pages project "${name}" does not exist yet.`);
  const create = await ctx.state.confirm(`Create the Cloudflare Pages project "${name}" now?`);
  if (!create) {
    ctx.state.render.error("deploy failed", originalError);
    ctx.state.render.info(projectNotFoundHint(name));
    return { deployed: false, reason: "failed" };
  }

  // Create the project, surfacing a create failure (e.g. auth) as a styled error.
  try {
    const created = await deploy.createProject();
    ctx.state.render.check(true, `created Cloudflare Pages project "${created.name}"`);
  } catch (error) {
    ctx.state.render.error("could not create the Pages project", error);
    ctx.state.render.info(deployFailureHint(error));
    return { deployed: false, reason: "failed" };
  }

  // Retry the deploy once now that the project exists.
  ctx.state.render.info("project created — retrying the deploy…");
  try {
    return await deployOnce(ctx, options);
  } catch (error) {
    return renderFailure(ctx, error);
  }
}

/**
 * Run the deploy step: confirm (unless `yes`), then deploy via the deploy plugin. A
 * declined confirm returns `{ deployed: false, reason: "declined" }`. A project-not-found
 * failure offers to create the project (with a confirmation step) and retries; any other
 * runtime failure is surfaced as a styled error + fix hint, returning
 * `{ deployed: false, reason: "failed" }` — never a raw stack trace.
 *
 * @param ctx - The cli plugin context.
 * @param options - The deploy options (branch override + `yes`).
 * @returns The deploy outcome.
 * @example
 * const outcome = await runDeployStep(ctx, { yes: true });
 */
async function runDeployStep(
  ctx: CliPluginContext,
  options: DeployOptions
): Promise<DeployOutcome> {
  ctx.state.render.heading("Deploy");
  const proceed =
    options.yes === true ||
    (await ctx.state.confirm(`Deploy ${ctx.config.outDir}/ to Cloudflare Pages now?`));
  if (!proceed) {
    ctx.state.render.warn("deploy skipped");
    return { deployed: false, reason: "declined" };
  }

  try {
    return await deployOnce(ctx, options);
  } catch (error) {
    // Project not created yet → offer to create it (confirmed) and retry; else fail cleanly.
    if (codeOf(error) === "ERR_DEPLOY_PROJECT_NOT_FOUND") {
      return createProjectThenRetry(ctx, options, error);
    }
    return renderFailure(ctx, error);
  }
}

/**
 * Run the guided deploy wizard end to end: diagnose prerequisites (offering to scaffold
 * the wrangler config), HARD-GATE on the remaining blockers, run a local build smoke
 * test, deploy (with confirmation), then offer to scaffold a CI workflow. Returns
 * `{ deployed: false, reason: "blocked" }` when prerequisites are unmet, so a thin script
 * can exit non-zero. Assumes the caller already rendered the `deploy` header.
 *
 * @param ctx - The cli plugin context (state seams + `require` + config).
 * @param options - The deploy options (branch override, `yes`, `guided`).
 * @returns The deploy outcome (`deployed`, or a `declined`/`blocked` skip).
 * @example
 * const outcome = await runDeployWizard(ctx, { guided: true });
 */
export async function runDeployWizard(
  ctx: CliPluginContext,
  options: DeployOptions
): Promise<DeployOutcome> {
  const cwd = process.cwd();

  // 1. Prerequisites — show every check, then offer to scaffold the fixable ones
  //    (wrangler.jsonc, plus a placeholder .env for any missing Cloudflare credentials).
  ctx.state.render.heading("Checking prerequisites");
  for (const item of diagnose(ctx, cwd)) ctx.state.render.check(item.ok, item.label, item.detail);
  await offerScaffold(ctx, diagnose(ctx, cwd));
  await offerEnvScaffold(ctx, cwd);

  // 2. Hard gate — re-check and stop (without deploying) while any blocker remains.
  const blockers = diagnose(ctx, cwd).filter(item => !item.ok);
  if (blockers.length > 0) {
    ctx.state.render.heading("Not ready to deploy");
    for (const item of blockers) ctx.state.render.check(false, item.label, item.detail);
    ctx.state.render.warn(
      `Fix the ${blockers.length} item(s) above, then re-run \`bun run deploy\`.`
    );
    return { deployed: false, reason: "blocked" };
  }

  // 3. Local test — build fresh, confirm the 404 page, suggest a preview.
  ctx.state.render.heading("Local test");
  const summary = await ctx.require(buildPlugin).run();
  ctx.state.render.check(true, `built ${summary.pageCount} pages → ${summary.outDir}/`);
  const notFoundOk = existsSync(path.join(ctx.config.outDir, ctx.config.notFoundFile));
  ctx.state.render.check(
    notFoundOk,
    `${ctx.config.notFoundFile} present`,
    notFoundOk
      ? undefined
      : "Set build.notFound so the SSG emits it (CF Pages else flips to SPA mode)."
  );
  ctx.state.render.info("Tip: run `bun run preview` to eyeball the built site before deploying.");

  // 4. Deploy, then 5. offer CI workflow setup — but not after a hard deploy failure
  //    (the deploy is broken; don't pile a CI-setup prompt on top of the fix hint).
  const outcome = await runDeployStep(ctx, options);
  const deployFailed = outcome.deployed === false && outcome.reason === "failed";
  if (!deployFailed) await offerWorkflowSetup(ctx);
  return outcome;
}
