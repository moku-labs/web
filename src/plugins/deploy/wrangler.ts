/**
 * @file deploy plugin — wrangler subprocess invocation, secret scrubbing, the
 * branch/path guards, output parsing, and the wrangler error taxonomy.
 */
import path from "node:path";
import type { DeployErrorCode, SpawnFunction, WranglerErrorKind } from "./types";

/**
 * Single source of truth for the pinned wrangler version. Used by the workflow
 * generator and the spawn invocation so the deployed and generated versions can
 * never drift.
 */
export const MOKU_WRANGLER_VERSION = "4.34.0";

/** Error prefix for deploy runtime failures (spec/11 Part-3). */
const ERROR_PREFIX = "[web] deploy";

/** Mask substituted for a detected secret-like token. */
const MASK = "***";

/** Minimum token length eligible for entropy-gated scrubbing. */
const MIN_SECRET_LENGTH = 16;

/** Minimum Shannon entropy (bits/char) for a token to be treated as a secret. */
const MIN_SECRET_ENTROPY = 3.5;

/** Branch guard regex — rejects flag injection and shell metacharacters. */
const BRANCH_REGEX = /^[a-zA-Z0-9/_.-]+$/;

/** Matches a Cloudflare Pages deployment URL in wrangler stdout. */
const DEPLOY_URL_REGEX = /https:\/\/[a-z0-9-]+\.pages\.dev/i;

/** Matches a Cloudflare deployment ID in wrangler stdout. */
const DEPLOYMENT_ID_REGEX = /Deployment ID: ([a-f0-9-]+)/i;

/**
 * Construct a deploy `Error` carrying a taxonomy `code` property. Centralizes the
 * `Object.assign(new Error(message), { code })` pattern so the `code` is always
 * preserved on the thrown value.
 *
 * @param code - The deploy error `code` from the taxonomy.
 * @param message - The actionable, already-scrubbed error message.
 * @returns An `Error` whose `code` property is set.
 * @example
 * throw deployError("ERR_DEPLOY_INVALID_BRANCH", "[web] deploy: bad branch.");
 */
export function deployError(
  code: DeployErrorCode,
  message: string
): Error & { code: DeployErrorCode } {
  return Object.assign(new Error(message), { code });
}

/**
 * Compute the Shannon entropy (bits per character) of a string.
 *
 * @param token - The token to measure.
 * @returns The per-character Shannon entropy in bits.
 * @example
 * shannonBitsPerChar("aaaa"); // 0
 */
function shannonBitsPerChar(token: string): number {
  if (token.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of token) counts.set(char, (counts.get(char) ?? 0) + 1);

  // Accumulate -Σ p·log2(p) across the per-character frequencies.
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / token.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Test whether a token looks like a high-entropy secret. A token qualifies only
 * when it is **both** ≥ `MIN_SECRET_LENGTH` chars **and** has ≥ `MIN_SECRET_ENTROPY`
 * bits/char of Shannon entropy.
 *
 * @param token - The candidate token.
 * @returns `true` when the token is long and random enough to mask.
 * @example
 * isHighEntropyToken("aZ9...long...Qx"); // true
 */
function isHighEntropyToken(token: string): boolean {
  return token.length >= MIN_SECRET_LENGTH && shannonBitsPerChar(token) >= MIN_SECRET_ENTROPY;
}

/**
 * Mask high-entropy secret-like tokens in subprocess output before it is logged.
 * A token is masked only when it is **both** ≥ 16 chars **and** ≥ 3.5 bits/char
 * Shannon entropy, **unless** it contains an allowlisted substring (e.g.
 * `CLOUDFLARE_ACCOUNT_ID`). Tokenization splits on whitespace, preserving the
 * original separators so messages stay readable.
 *
 * @param text - Raw stdout/stderr text to scrub before logging.
 * @param allowlist - Substrings exempt from scrubbing (e.g. `CLOUDFLARE_ACCOUNT_ID`).
 * @returns The text with secret-like tokens replaced by `***`.
 * @example
 * scrubSecrets("token aZ9...long...Qx used", ["CLOUDFLARE_ACCOUNT_ID"]);
 */
export function scrubSecrets(text: string, allowlist: string[]): string {
  return text.replaceAll(/\S+/g, token => {
    if (allowlist.some(allowed => allowed.length > 0 && token.includes(allowed))) {
      return token;
    }
    if (isHighEntropyToken(token)) return MASK;
    return token;
  });
}

/**
 * Test whether a branch name fails the deploy guard. A branch is invalid when it
 * does not match `BRANCH_REGEX` or has a leading `-` (which wrangler would parse
 * as a flag).
 *
 * @param branch - The candidate branch name.
 * @returns `true` when the branch must be rejected.
 * @example
 * isInvalidBranch("--config"); // true
 */
function isInvalidBranch(branch: string): boolean {
  return !BRANCH_REGEX.test(branch) || branch.startsWith("-");
}

/**
 * Guard a branch name against flag injection and shell metacharacters. Only
 * `/^[a-zA-Z0-9/_.-]+$/` is accepted so a value can never be interpreted as a
 * wrangler flag (e.g. `--config`).
 *
 * @param branch - The candidate branch name.
 * @returns The validated branch (unchanged) when it passes the guard.
 * @throws {Error} `ERR_DEPLOY_INVALID_BRANCH` when the branch fails the guard.
 * @example
 * guardBranch("preview/landing"); // "preview/landing"
 */
export function guardBranch(branch: string): string {
  // A leading `-` would be parsed by wrangler as a flag (e.g. `--config`), so it
  // is rejected even though `-` is a valid interior character.
  if (isInvalidBranch(branch)) {
    throw deployError(
      "ERR_DEPLOY_INVALID_BRANCH",
      `${ERROR_PREFIX}: branch ${JSON.stringify(branch)} is invalid.\n  Branches must match /^[a-zA-Z0-9/_.-]+$/ so they cannot inject wrangler flags.`
    );
  }
  return branch;
}

/**
 * Test whether a resolved path stays within the resolved project root. The path
 * is contained when it equals the root or sits beneath it (`root` + separator).
 *
 * @param resolved - The resolved absolute candidate path.
 * @param rootResolved - The resolved absolute project root.
 * @returns `true` when `resolved` is the root or nested inside it.
 * @example
 * isWithinRoot("/app/dist", "/app"); // true
 */
function isWithinRoot(resolved: string, rootResolved: string): boolean {
  return resolved === rootResolved || resolved.startsWith(rootResolved + path.sep);
}

/**
 * Resolve `outDir` against the project root and assert it stays within the root,
 * defending against a config that points outside the project (path traversal).
 *
 * @param outDir - The configured output directory (relative or absolute).
 * @param root - The absolute project root the outDir must be contained within.
 * @returns The resolved absolute output directory.
 * @throws {Error} `ERR_DEPLOY_PATH_TRAVERSAL` when the resolved path escapes root.
 * @example
 * assertWithinRoot("dist", process.cwd());
 */
export function assertWithinRoot(outDir: string, root: string): string {
  const resolved = path.isAbsolute(outDir) ? path.resolve(outDir) : path.resolve(root, outDir);
  const rootResolved = path.resolve(root);
  if (!isWithinRoot(resolved, rootResolved)) {
    throw deployError(
      "ERR_DEPLOY_PATH_TRAVERSAL",
      `${ERROR_PREFIX}: outDir ${JSON.stringify(outDir)} resolves outside the project root.\n  Point outDir at a directory inside ${JSON.stringify(rootResolved)}.`
    );
  }
  return resolved;
}

/**
 * Assemble the wrangler argv array (no shell). Guards the branch against flag
 * injection and re-validates the resolved `outDir` against the project root before
 * building the array.
 *
 * @param input - The resolved invocation inputs.
 * @param input.outDir - Output directory to deploy (re-validated against root).
 * @param input.slug - Cloudflare project-name slug.
 * @param input.branch - Branch to deploy (guarded by `/^[a-zA-Z0-9/_.-]+$/`).
 * @param input.root - Absolute project root used for the path-traversal check.
 * @returns The wrangler argv array.
 * @throws {Error} `ERR_DEPLOY_INVALID_BRANCH` or `ERR_DEPLOY_PATH_TRAVERSAL`.
 * @example
 * buildWranglerArgs({ outDir: "dist", slug: "my-site", branch: "main", root: process.cwd() });
 */
export function buildWranglerArgs(input: {
  outDir: string;
  slug: string;
  branch: string;
  root: string;
}): string[] {
  // Reject an injectable branch and an out-of-root outDir before touching argv.
  const branch = guardBranch(input.branch);
  assertWithinRoot(input.outDir, input.root);

  // Assemble the no-shell argv for `wrangler pages deploy`.
  return [
    "bunx",
    "wrangler",
    "pages",
    "deploy",
    input.outDir,
    "--project-name",
    input.slug,
    "--branch",
    branch
  ];
}

/**
 * Assemble the argv for `wrangler pages project create` (no shell). Guards the
 * production branch against flag injection; the slug is already a safe `toSlug` output.
 *
 * @param input - The resolved project-create inputs.
 * @param input.slug - Cloudflare project-name slug (`toSlug(site.name())`).
 * @param input.branch - Production branch (guarded by `/^[a-zA-Z0-9/_.-]+$/`).
 * @returns The wrangler argv array.
 * @throws {Error} `ERR_DEPLOY_INVALID_BRANCH` when the branch fails the guard.
 * @example
 * buildProjectCreateArgs({ slug: "my-site", branch: "main" });
 */
export function buildProjectCreateArgs(input: { slug: string; branch: string }): string[] {
  // Reject an injectable production branch before assembling argv.
  const branch = guardBranch(input.branch);

  // Assemble the no-shell argv for `wrangler pages project create`.
  return [
    "bunx",
    "wrangler",
    "pages",
    "project",
    "create",
    input.slug,
    "--production-branch",
    branch
  ];
}

/** Lowercased substring matchers for the wrangler error taxonomy. */
const ERROR_SIGNATURES: { match: string[]; kind: WranglerErrorKind; advice: string }[] = [
  {
    match: ["could not find project", "project not found"],
    kind: "ERR_DEPLOY_PROJECT_NOT_FOUND",
    advice:
      "The Cloudflare Pages project does not exist yet. Create it in the dashboard (Workers & Pages → Create → Pages) or with `bunx wrangler pages project create <name>`, then retry. (app.deploy.init() only scaffolds local config — it does not create the remote project.)"
  },
  {
    match: ["jwt", "session expired", "expired"],
    kind: "ERR_DEPLOY_AUTH_EXPIRED",
    advice: "Your Cloudflare session/token expired. Refresh CLOUDFLARE_API_TOKEN and retry."
  },
  {
    match: ["unauthorized", "permission", "auth"],
    kind: "ERR_DEPLOY_AUTH",
    advice: "Authentication failed. Check the scope of CLOUDFLARE_API_TOKEN."
  },
  {
    match: ["fetch failed", "enotfound", "etimedout", "network"],
    kind: "ERR_DEPLOY_NETWORK",
    advice: "A network failure occurred. Check connectivity and retry."
  }
];

/** Number of trailing characters of scrubbed stderr to surface on an unknown failure. */
const STDERR_TAIL_LENGTH = 500;

/**
 * Map a non-zero wrangler exit and scrubbed stderr to an actionable error
 * `code` + message. Matching is case-insensitive against the scrubbed stderr;
 * unmatched non-zero exits fall back to `ERR_DEPLOY_WRANGLER_FAILED` with the
 * scrubbed stderr tail.
 *
 * @param exitCode - The wrangler process exit code.
 * @param scrubbedStderr - The already-scrubbed stderr (never raw stderr).
 * @returns The matched `code` and actionable message.
 * @example
 * classifyWranglerError(1, "Could not find project with name my-site");
 */
export function classifyWranglerError(
  exitCode: number,
  scrubbedStderr: string
): { code: WranglerErrorKind; message: string } {
  // Match the scrubbed stderr against the taxonomy and surface the first hit's advice.
  const haystack = scrubbedStderr.toLowerCase();
  for (const signature of ERROR_SIGNATURES) {
    if (signature.match.some(needle => haystack.includes(needle))) {
      return {
        code: signature.kind,
        message: `${ERROR_PREFIX}: wrangler failed (exit ${exitCode}).\n  ${signature.advice}`
      };
    }
  }

  // Fallback: no signature matched — report a generic failure with the stderr tail.
  const tail = scrubbedStderr.trim().slice(-STDERR_TAIL_LENGTH);
  return {
    code: "ERR_DEPLOY_WRANGLER_FAILED",
    message: `${ERROR_PREFIX}: wrangler failed (exit ${exitCode}).\n  ${tail}`
  };
}

/**
 * Extract the Cloudflare Pages deployment URL from wrangler stdout.
 *
 * @param stdout - The captured wrangler stdout.
 * @returns The `*.pages.dev` URL, or `""` when none is present.
 * @example
 * parseDeployUrl("...https://my-site.pages.dev..."); // "https://my-site.pages.dev"
 */
export function parseDeployUrl(stdout: string): string {
  return DEPLOY_URL_REGEX.exec(stdout)?.[0] ?? "";
}

/**
 * Extract the Cloudflare deployment ID from wrangler stdout.
 *
 * @param stdout - The captured wrangler stdout.
 * @returns The deployment ID, or `""` when none is present.
 * @example
 * parseDeploymentId("Deployment ID: deadbeef"); // "deadbeef"
 */
export function parseDeploymentId(stdout: string): string {
  return DEPLOYMENT_ID_REGEX.exec(stdout)?.[1] ?? "";
}

/**
 * Spawn the wrangler subprocess via the injected spawner, await it, and scrub the
 * output. The `CLOUDFLARE_API_TOKEN` is passed via the subprocess `env` only —
 * never via argv and never logged. Returns the raw stdout (for parsing) plus the
 * already-scrubbed stderr and exit code; callers must use `scrubbedStderr` (never
 * raw stderr) for any `ctx.log` call.
 *
 * @param input - The spawn invocation inputs.
 * @param input.spawn - Injectable subprocess spawner from state.
 * @param input.args - The wrangler argv array (from {@link buildWranglerArgs}).
 * @param input.token - `CLOUDFLARE_API_TOKEN`, passed to env only — never logged.
 * @param input.allowlist - Scrub allowlist applied to output before logging.
 * @returns The raw stdout, the scrubbed stderr, and the exit code.
 * @example
 * await runWrangler({ spawn, args, token, allowlist: ["CLOUDFLARE_ACCOUNT_ID"] });
 */
export async function runWrangler(input: {
  spawn: SpawnFunction;
  args: string[];
  token: string;
  allowlist: string[];
}): Promise<{ stdout: string; scrubbedStderr: string; exitCode: number }> {
  // Spawn wrangler with the token in env (never argv) and drain both streams.
  const proc = input.spawn(input.args, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLOUDFLARE_API_TOKEN: input.token }
  });
  const stdout = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
  const stderr = await new Response(proc.stderr as ReadableStream<Uint8Array>).text();
  const exitCode = await proc.exited;

  // Scrub stderr BEFORE returning — only scrubbed* names may reach ctx.log downstream.
  const scrubbedStderr = scrubSecrets(stderr, input.allowlist);
  return { stdout, scrubbedStderr, exitCode };
}
