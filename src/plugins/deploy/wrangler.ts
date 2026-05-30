/**
 * @file deploy plugin — wrangler subprocess invocation, secret scrubbing, and
 * error taxonomy.
 */
import type { SpawnFunction, WranglerErrorKind } from "./types";

/**
 * Single source of truth for the pinned wrangler version. Used by the workflow
 * generator and (where applicable) the spawn invocation so the deployed and
 * generated versions can never drift.
 */
export const MOKU_WRANGLER_VERSION = "0.0.0-pinned";

/** Shared skeleton stub message (factored out to avoid duplicate-literal lint). */
const NOT_IMPLEMENTED = "not implemented";

/**
 * Assemble the wrangler argv array (no shell). Guards the branch against flag
 * injection and re-validates the resolved outDir against the project root.
 *
 * @param _input - The resolved invocation inputs.
 * @param _input.outDir - Output directory to deploy (re-validated against root).
 * @param _input.slug - Cloudflare project-name slug.
 * @param _input.branch - Branch to deploy (guarded by /^[a-zA-Z0-9/_.-]+$/).
 * @param _input.root - Absolute project root used for the path-traversal check.
 * @throws {Error} Always — skeleton stub, implemented during build.
 * @example
 * buildWranglerArgs({ outDir: "dist", slug: "my-site", branch: "main", root: process.cwd() });
 */
export function buildWranglerArgs(_input: {
  outDir: string;
  slug: string;
  branch: string;
  root: string;
}): string[] {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Mask high-entropy secret-like tokens (>= 16 chars and >= 3.5 bits/char Shannon
 * entropy) in subprocess output, preserving allowlisted substrings.
 *
 * @param _text - Raw stdout/stderr text to scrub before logging.
 * @param _allowlist - Substrings exempt from scrubbing (e.g. CLOUDFLARE_ACCOUNT_ID).
 * @throws {Error} Always — skeleton stub, implemented during build.
 * @example
 * scrubSecrets(rawOutput, ["CLOUDFLARE_ACCOUNT_ID"]);
 */
export function scrubSecrets(_text: string, _allowlist: string[]): string {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Map a non-zero wrangler exit + scrubbed stderr to an actionable error code/message.
 *
 * @param _exitCode - The wrangler process exit code.
 * @param _scrubbedStderr - The already-scrubbed stderr (never raw stderr).
 * @throws {Error} Always — skeleton stub, implemented during build.
 * @example
 * classifyWranglerError(1, "project not found");
 */
export function classifyWranglerError(
  _exitCode: number,
  _scrubbedStderr: string
): { code: WranglerErrorKind; message: string } {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Spawn the wrangler subprocess via the injected spawner, await it, scrub output,
 * and either classify a failure or return the captured stdout for parsing.
 *
 * @param _input - The spawn invocation inputs.
 * @param _input.spawn - Injectable subprocess spawner from state.
 * @param _input.args - The wrangler argv array (from buildWranglerArgs).
 * @param _input.token - CLOUDFLARE_API_TOKEN, passed to env only — never logged.
 * @param _input.allowlist - Scrub allowlist applied to output before logging.
 * @throws {Error} Always — skeleton stub, implemented during build.
 * @example
 * await runWrangler({ spawn, args, token, allowlist: ["CLOUDFLARE_ACCOUNT_ID"] });
 */
export function runWrangler(_input: {
  spawn: SpawnFunction;
  args: string[];
  token: string;
  allowlist: string[];
}): Promise<{ stdout: string; scrubbedStderr: string; exitCode: number }> {
  throw new Error(NOT_IMPLEMENTED);
}
