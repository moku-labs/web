import { describe, expect, it, vi } from "vitest";
import { sitePlugin } from "../../../site";
import { validateConfig } from "../../api";
import type { Config, State } from "../../types";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    target: "cloudflare-pages",
    outDir: "dist",
    productionBranch: "main",
    scrubAllowlist: ["CLOUDFLARE_ACCOUNT_ID"],
    compatibilityDate: "2024-01-01",
    ci: false,
    ...overrides
  };
}

/** Minimal deploy onInit ctx: only `config` + `require` are read by validateConfig. */
function makeCtx(config: Config) {
  const requireFn = vi.fn(() => ({ name: () => "Site" }));
  const state: State = {
    // eslint-disable-next-line unicorn/no-null -- contract null.
    lastDeployment: null,
    spawn: (() => {
      throw new Error("unused");
    }) as State["spawn"]
  };
  // The cast mirrors the kernel passing the full plugin context.
  const ctx = {
    state,
    config,
    log: { info: vi.fn() },
    env: { require: vi.fn() },
    emit: vi.fn(),
    require: requireFn
  } as unknown as Parameters<typeof validateConfig>[0];
  return { ctx, requireFn };
}

describe("deploy/validateConfig", () => {
  it("accepts the default config and resolves the site dependency", () => {
    const { ctx, requireFn } = makeCtx(makeConfig());
    expect(() => validateConfig(ctx)).not.toThrow();
    expect(requireFn).toHaveBeenCalledWith(sitePlugin);
  });

  it("rejects a non cloudflare-pages target with ERR_DEPLOY_CONFIG", () => {
    const { ctx } = makeCtx(makeConfig({ target: "workers" as unknown as "cloudflare-pages" }));
    expect(() => validateConfig(ctx)).toThrowError(
      expect.objectContaining({ code: "ERR_DEPLOY_CONFIG" })
    );
  });

  it("rejects an empty outDir with ERR_DEPLOY_CONFIG", () => {
    const { ctx } = makeCtx(makeConfig({ outDir: "" }));
    expect(() => validateConfig(ctx)).toThrowError(
      expect.objectContaining({ code: "ERR_DEPLOY_CONFIG" })
    );
  });

  it("rejects a non-array / non-string scrubAllowlist with ERR_DEPLOY_CONFIG", () => {
    const bad = makeConfig({ scrubAllowlist: "nope" as unknown as string[] });
    expect(() => validateConfig(makeCtx(bad).ctx)).toThrowError(
      expect.objectContaining({ code: "ERR_DEPLOY_CONFIG" })
    );
    const badItem = makeConfig({ scrubAllowlist: [1 as unknown as string] });
    expect(() => validateConfig(makeCtx(badItem).ctx)).toThrowError(
      expect.objectContaining({ code: "ERR_DEPLOY_CONFIG" })
    );
  });

  it("rejects a malformed compatibilityDate with ERR_DEPLOY_CONFIG", () => {
    const { ctx } = makeCtx(makeConfig({ compatibilityDate: "2024/01/01" }));
    expect(() => validateConfig(ctx)).toThrowError(
      expect.objectContaining({ code: "ERR_DEPLOY_CONFIG" })
    );
  });

  it("accepts an omitted compatibilityDate", () => {
    const config = makeConfig();
    delete config.compatibilityDate;
    expect(() => validateConfig(makeCtx(config).ctx)).not.toThrow();
  });
});
