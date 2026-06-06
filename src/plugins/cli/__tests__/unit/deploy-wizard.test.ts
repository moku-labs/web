import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDeployWizard } from "../../deploy-wizard";
import type { CaptureRenderer } from "../helpers";
import { makeCtx } from "../helpers";

/** The Cloudflare credentials the wizard checks for in the environment. */
const TOKEN = "CLOUDFLARE_API_TOKEN";
const ACCOUNT = "CLOUDFLARE_ACCOUNT_ID";

/** Write a wrangler.jsonc into the temp project so the wrangler prerequisite passes. */
function writeWrangler(root: string): void {
  writeFileSync(path.join(root, "wrangler.jsonc"), '{ "name": "fixture" }\n', "utf8");
}

/** Write a dist/404.html so the local-test 404 check passes. */
function writeNotFound(root: string): void {
  mkdirSync(path.join(root, "dist"), { recursive: true });
  writeFileSync(path.join(root, "dist", "404.html"), "<html></html>", "utf8");
}

describe("cli/runDeployWizard (guided deploy)", () => {
  let tmp: string;
  let prevCwd: string;
  let prevToken: string | undefined;
  let prevAccount: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "deploy-wizard-"));
    prevCwd = process.cwd();
    prevToken = process.env[TOKEN];
    prevAccount = process.env[ACCOUNT];
    process.chdir(tmp);
    delete process.env[TOKEN];
    delete process.env[ACCOUNT];
  });

  afterEach(() => {
    process.chdir(prevCwd);
    if (prevToken === undefined) delete process.env[TOKEN];
    else process.env[TOKEN] = prevToken;
    if (prevAccount === undefined) delete process.env[ACCOUNT];
    else process.env[ACCOUNT] = prevAccount;
    rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("blocks (no deploy) when the Cloudflare credentials are missing", async () => {
    writeWrangler(tmp); // wrangler present; credentials are the blockers
    const { ctx, build, deploy } = makeCtx();

    const outcome = await runDeployWizard(ctx, { guided: true });

    expect(outcome).toEqual({ deployed: false, reason: "blocked" });
    expect(build.run).not.toHaveBeenCalled(); // gated before the local-test build
    expect(deploy.run).not.toHaveBeenCalled();
    // The credentials were reported as failing checks.
    const checks = (ctx.state.render as CaptureRenderer).calls.filter(c => c[0] === "check");
    expect(checks.some(c => c[1] === false && String(c[2]).includes(TOKEN))).toBe(true);
    expect(checks.some(c => c[1] === false && String(c[2]).includes(ACCOUNT))).toBe(true);
  });

  it("deploys and scaffolds an auto workflow when everything is green", async () => {
    writeWrangler(tmp);
    writeNotFound(tmp);
    process.env[TOKEN] = "tkn";
    process.env[ACCOUNT] = "acct";
    const { ctx, build, deploy } = makeCtx({
      state: { confirm: vi.fn(async () => true), select: vi.fn(async () => 0) }
    });

    const outcome = await runDeployWizard(ctx, { guided: true });

    expect(outcome.deployed).toBe(true);
    expect(build.run).toHaveBeenCalledTimes(1); // the local-test build
    expect(deploy.run).toHaveBeenCalledTimes(1); // the actual deploy
    // Workflow setup chose option 0 → an "auto" trigger.
    expect(deploy.init).toHaveBeenCalledWith({ ci: true, workflowTrigger: "auto" });
  });

  it("routes the manual/versioned choice through the tag sub-option", async () => {
    writeWrangler(tmp);
    writeNotFound(tmp);
    process.env[TOKEN] = "tkn";
    process.env[ACCOUNT] = "acct";
    // First select() = manual/versioned (1); second select() (sub) = tag (0).
    let selectCalls = 0;
    const { ctx, deploy } = makeCtx({
      state: {
        confirm: vi.fn(async () => true),
        select: vi.fn(async () => (selectCalls++ === 0 ? 1 : 0))
      }
    });

    await runDeployWizard(ctx, { guided: true });

    expect(deploy.init).toHaveBeenCalledWith({ ci: true, workflowTrigger: "versioned-tag" });
  });

  it("offers to scaffold wrangler.jsonc when it is missing", async () => {
    // No wrangler.jsonc, but credentials present; accept the scaffold offer.
    writeNotFound(tmp);
    process.env[TOKEN] = "tkn";
    process.env[ACCOUNT] = "acct";
    const { ctx, deploy } = makeCtx({
      state: { confirm: vi.fn(async () => true), select: vi.fn(async () => 2 /* skip workflow */) }
    });
    // The real init writes the file; emulate that so the post-fix gate passes.
    deploy.init = vi.fn(async () => {
      writeWrangler(tmp);
      return { written: ["wrangler.jsonc"], skipped: [], drifted: [] };
    });

    const outcome = await runDeployWizard(ctx, { guided: true });

    // init was called once for the scaffold (workflow setup was skipped → option 2).
    expect(deploy.init).toHaveBeenCalledWith({});
    expect(outcome.deployed).toBe(true);
  });

  it("declines cleanly when the user says no at the deploy confirm", async () => {
    writeWrangler(tmp);
    writeNotFound(tmp);
    process.env[TOKEN] = "tkn";
    process.env[ACCOUNT] = "acct";
    const { ctx, deploy } = makeCtx({
      state: { confirm: vi.fn(async () => false), select: vi.fn(async () => 2) }
    });

    const outcome = await runDeployWizard(ctx, { guided: true });

    expect(outcome).toEqual({ deployed: false, reason: "declined" });
    expect(deploy.run).not.toHaveBeenCalled();
  });
});
