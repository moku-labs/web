import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApi } from "../../api";
import { makeCtx, makeRenderer } from "../helpers";

/** A no-op teardown used before/after a TTY override is installed. */
const NOOP = (): void => undefined;

/** Override process.stdout.isTTY for one test and restore it afterwards. */
function setTTY(value: boolean | undefined): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
  return () => {
    if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor);
    else Reflect.deleteProperty(process.stdout, "isTTY");
  };
}

describe("cli deploy() gate", () => {
  let restoreTTY: () => void = NOOP;
  const originalCI = process.env.CI;

  beforeEach(() => {
    // `CI` decides interactivity alongside the TTY check — clear it so each test
    // builds its own world (and the suite itself running under CI never leaks in).
    delete process.env.CI;
  });
  afterEach(() => {
    restoreTTY();
    restoreTTY = NOOP;
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
  });

  it("deploys immediately when { yes: true }, skipping the prompt even on a TTY", async () => {
    restoreTTY = setTTY(true);
    const { ctx, deploy } = makeCtx();
    const outcome = await createApi(ctx).deploy({ yes: true });
    expect(deploy.init).toHaveBeenCalledWith({ ci: true });
    expect(deploy.run).toHaveBeenCalledTimes(1);
    expect(ctx.state.confirm).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ deployed: true, url: "https://example.pages.dev" });
  });

  it("on a TTY without a flag, prompts and deploys when confirm → true", async () => {
    restoreTTY = setTTY(true);
    const confirm = vi.fn(async () => true);
    const { ctx, deploy } = makeCtx({ state: { confirm } });
    const outcome = await createApi(ctx).deploy();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(deploy.run).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ deployed: true });
  });

  it("on a TTY, returns { deployed:false, reason:'declined' } when confirm → false", async () => {
    restoreTTY = setTTY(true);
    const confirm = vi.fn(async () => false);
    const { ctx, deploy } = makeCtx({ state: { confirm } });
    const outcome = await createApi(ctx).deploy();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(deploy.run).not.toHaveBeenCalled();
    expect(outcome).toEqual({ deployed: false, reason: "declined" });
  });

  it("in a non-TTY (CI / piped), deploys without prompting", async () => {
    restoreTTY = setTTY(false);
    const confirm = vi.fn(async () => true);
    const { ctx, deploy } = makeCtx({ state: { confirm } });
    const outcome = await createApi(ctx).deploy();
    expect(confirm).not.toHaveBeenCalled();
    expect(deploy.run).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ deployed: true });
  });

  it("with CI=true even on a TTY, still deploys without prompting", async () => {
    restoreTTY = setTTY(true);
    process.env.CI = "true";
    const confirm = vi.fn(async () => true);
    const { ctx, deploy } = makeCtx({ state: { confirm } });
    const outcome = await createApi(ctx).deploy();
    expect(confirm).not.toHaveBeenCalled();
    expect(deploy.run).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ deployed: true });
  });

  it("renders an info note when it skips confirmation non-interactively", async () => {
    restoreTTY = setTTY(false);
    const render = makeRenderer();
    const { ctx, deploy } = makeCtx({ render });
    await createApi(ctx).deploy();
    expect(deploy.run).toHaveBeenCalledTimes(1);
    expect(render.calls).toContainEqual(["info", "non-interactive — skipping deploy confirmation"]);
  });

  it("forwards the branch option to deploy.run", async () => {
    restoreTTY = setTTY(false);
    const { ctx, deploy } = makeCtx();
    await createApi(ctx).deploy({ yes: true, branch: "preview/x" });
    expect(deploy.run).toHaveBeenCalledWith({ branch: "preview/x" });
  });

  it("calls deploy.run with {} when no branch is given", async () => {
    restoreTTY = setTTY(false);
    const { ctx, deploy } = makeCtx();
    await createApi(ctx).deploy({ yes: true });
    expect(deploy.run).toHaveBeenCalledWith({});
  });

  it("renders a styled '✗ deploy failed' error and rethrows when deploy.run rejects", async () => {
    restoreTTY = setTTY(false);
    const render = makeRenderer();
    const { ctx, deploy } = makeCtx({ render });
    const failure = new Error(
      '[web] env: required variable "CLOUDFLARE_API_TOKEN" is not defined.'
    );
    deploy.run.mockRejectedValueOnce(failure);

    // The failure still propagates (so a non-interactive run exits non-zero)...
    await expect(createApi(ctx).deploy({ yes: true })).rejects.toBe(failure);
    // ...but it is surfaced through the Panel renderer first (the ✗ vibe), with the cause...
    expect(render.calls).toContainEqual(["error", "deploy failed", failure]);
    // ...followed by an actionable "how to fix" hint naming the missing secret + guided deploy.
    const hint = render.calls.find(call => call[0] === "info")?.[1];
    expect(hint).toContain("how to fix");
    expect(hint).toContain("CLOUDFLARE_API_TOKEN");
    expect(hint).toContain("guided");
  });
});
