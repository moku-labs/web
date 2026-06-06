import { describe, expect, it } from "vitest";
import { createApi } from "../../api";
import { makeCtx, makeSpawn } from "../helpers";

describe("deploy createProject / projectName", () => {
  it("projectName() returns the slug derived from site.name()", () => {
    const { spawn } = makeSpawn({ exitCode: 0 });
    const ctx = makeCtx({ spawn, siteName: "My Cool Site!" });
    expect(createApi(ctx).projectName()).toBe("my-cool-site");
  });

  it("spawns `pages project create <slug> --production-branch <branch>` and returns the result", async () => {
    const { spawn, calls } = makeSpawn({ stdout: "Created project my-site", exitCode: 0 });
    const ctx = makeCtx({
      spawn,
      siteName: "My Site",
      config: { productionBranch: "main" }
    });

    const result = await createApi(ctx).createProject();

    expect(result).toEqual({ name: "my-site", branch: "main" });
    expect(calls).toHaveLength(1);
    const cmd = calls[0]?.cmd ?? [];
    expect(cmd[0]).toBe("bunx");
    expect(cmd).toContain("pages");
    expect(cmd).toContain("project");
    expect(cmd).toContain("create");
    expect(cmd).toContain("my-site");
    expect(cmd).toContain("--production-branch");
    expect(cmd).toContain("main");
    // No deploy URL parsing here — and nothing is emitted (create is not a deploy).
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it("passes CLOUDFLARE_API_TOKEN to the subprocess env but never to a log call", async () => {
    const fakeToken = ["HZ8kQ2mWp9Lx4Tn", "6Rv3Bd7Yc1Fg5Js"].join("");
    const { spawn, calls } = makeSpawn({
      stderr: `warning: token ${fakeToken} used`,
      exitCode: 0
    });
    const ctx = makeCtx({ spawn, token: fakeToken });

    await createApi(ctx).createProject();

    expect(calls[0]?.env.CLOUDFLARE_API_TOKEN).toBe(fakeToken);
    for (const call of ctx.log.info.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(fakeToken);
    }
  });

  it("throws a classified deploy error on a non-zero wrangler exit", async () => {
    const { spawn } = makeSpawn({ stderr: "401 Unauthorized", exitCode: 1 });
    const ctx = makeCtx({ spawn });

    await expect(createApi(ctx).createProject()).rejects.toMatchObject({
      code: "ERR_DEPLOY_AUTH"
    });
  });
});
