/**
 * @file cli plugin — the guided deploy wizard (`cli.deploy({ guided: true })`). Walks a
 * human through a Cloudflare Pages deploy: checks prerequisites (wrangler config + the
 * Cloudflare credentials) with concrete fix guidance, offers to scaffold/build what is
 * missing, HARD-GATES the deploy on everything being green, runs a local build smoke
 * test, confirms, deploys, then offers to scaffold a GitHub Actions workflow (auto on
 * push to main, or a versioned/manual trigger). The non-guided `--cli` path stays in
 * `api.ts`. Every prompt + line of output flows through injectable `state` seams.
 */
import { existsSync } from "node:fs";
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
 * Evaluate the three deploy prerequisites against the current project: the Cloudflare
 * wrangler config exists, and both Cloudflare credentials are present in the environment.
 *
 * @param cwd - The project root (where `wrangler.jsonc` lives).
 * @returns The ordered prerequisite checks.
 * @example
 * const prereqs = diagnose(process.cwd());
 */
function diagnose(cwd: string): Prerequisite[] {
  const wranglerOk = existsSync(path.join(cwd, "wrangler.jsonc"));
  const tokenOk = (process.env.CLOUDFLARE_API_TOKEN ?? "") !== "";
  const accountOk = (process.env.CLOUDFLARE_ACCOUNT_ID ?? "") !== "";
  return [
    {
      ok: wranglerOk,
      label: "wrangler.jsonc (Cloudflare project config)",
      detail: wranglerOk
        ? undefined
        : "Missing — scaffold it (offered below) or run app.deploy.init().",
      scaffoldable: true
    },
    {
      ok: tokenOk,
      label: "CLOUDFLARE_API_TOKEN is set",
      detail: tokenOk ? undefined : TOKEN_HELP,
      scaffoldable: false
    },
    {
      ok: accountOk,
      label: "CLOUDFLARE_ACCOUNT_ID is set",
      detail: accountOk ? undefined : ACCOUNT_HELP,
      scaffoldable: false
    }
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
 * Run the deploy step: confirm (unless `yes`), then deploy via the deploy plugin and
 * report the outcome. A declined confirm returns `{ deployed: false, reason: "declined" }`.
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
  const result = await ctx
    .require(deployPlugin)
    .run(options.branch === undefined ? {} : { branch: options.branch });
  return { deployed: true, ...result };
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

  // 1. Prerequisites — show every check, then offer to scaffold the fixable one.
  ctx.state.render.heading("Checking prerequisites");
  for (const item of diagnose(cwd)) ctx.state.render.check(item.ok, item.label, item.detail);
  await offerScaffold(ctx, diagnose(cwd));

  // 2. Hard gate — re-check and stop (without deploying) while any blocker remains.
  const blockers = diagnose(cwd).filter(item => !item.ok);
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

  // 4. Deploy, then 5. offer CI workflow setup regardless of the deploy choice.
  const outcome = await runDeployStep(ctx, options);
  await offerWorkflowSetup(ctx);
  return outcome;
}
