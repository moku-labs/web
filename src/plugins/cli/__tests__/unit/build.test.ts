import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApi } from "../../api";
import { makeCtx } from "../helpers";

describe("cli build()", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "cli-build-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("renders the header, runs the build plugin, and returns its summary", async () => {
    writeFileSync(path.join(tmp, "404.html"), "<h1>nope</h1>", "utf8");
    const result = { outDir: tmp, pageCount: 5, durationMs: 99 };
    const { ctx, build, render } = makeCtx({ config: { outDir: tmp }, buildResult: result });

    const summary = await createApi(ctx).build();

    expect(build.run).toHaveBeenCalledTimes(1);
    expect(summary).toEqual(result);
    // Header rendered once at the start with the "build" command.
    const calls = (render as ReturnType<typeof makeCtx>["render"] & { calls: unknown[][] }).calls;
    expect(calls[0]).toEqual(["header", "build"]);
  });

  it("throws ERR_CLI_NOT_FOUND when the not-found page is missing (default assert)", async () => {
    const { ctx, render } = makeCtx({ config: { outDir: tmp } });
    await expect(createApi(ctx).build()).rejects.toMatchObject({ code: "ERR_CLI_NOT_FOUND" });
    // An error line is rendered before throwing.
    const calls = (render as ReturnType<typeof makeCtx>["render"] & { calls: unknown[][] }).calls;
    expect(calls.some(call => call[0] === "error")).toBe(true);
  });

  it("does NOT assert the not-found page when assertNotFound:false", async () => {
    const result = { outDir: tmp, pageCount: 1, durationMs: 1 };
    const { ctx, build } = makeCtx({ config: { outDir: tmp }, buildResult: result });
    const summary = await createApi(ctx).build({ assertNotFound: false });
    expect(summary).toEqual(result);
    expect(build.run).toHaveBeenCalledTimes(1);
  });

  it("respects a custom notFoundFile name", async () => {
    writeFileSync(path.join(tmp, "missing.html"), "x", "utf8");
    const { ctx } = makeCtx({ config: { outDir: tmp, notFoundFile: "missing.html" } });
    await expect(createApi(ctx).build()).resolves.toBeDefined();
  });
});
