import { describe, expect, it } from "vitest";
import { createState } from "../../state";

describe("deploy/createState", () => {
  it("starts with no lastDeployment and a default spawn", () => {
    const state = createState({ global: {}, config: {} as never });
    expect(state.lastDeployment).toBeNull();
    expect(typeof state.spawn).toBe("function");
  });

  it("default spawn throws a coded error when the Bun runtime is absent", () => {
    const state = createState({ global: {}, config: {} as never });
    const original = (globalThis as { Bun?: unknown }).Bun;
    try {
      // Simulate a non-Bun runtime (defaultSpawn checks `Bun === undefined`).
      (globalThis as { Bun?: unknown }).Bun = undefined;
      expect(() =>
        state.spawn(["bunx", "wrangler"], { stdout: "pipe", stderr: "pipe" })
      ).toThrowError(expect.objectContaining({ code: "ERR_DEPLOY_WRANGLER_FAILED" }));
    } finally {
      (globalThis as { Bun?: unknown }).Bun = original;
    }
  });

  it("default spawn delegates to Bun.spawn when the runtime is present", () => {
    const state = createState({ global: {}, config: {} as never });
    const original = (globalThis as { Bun?: unknown }).Bun;
    const calls: unknown[][] = [];
    const sentinel = { stdout: undefined, stderr: undefined, exited: Promise.resolve(0) };
    (globalThis as { Bun?: unknown }).Bun = {
      spawn: (...args: unknown[]) => {
        calls.push(args);
        return sentinel;
      }
    };
    try {
      const proc = state.spawn(["bunx", "wrangler"], { stdout: "pipe", stderr: "pipe" });
      expect(proc).toBe(sentinel);
      expect(calls).toHaveLength(1);
    } finally {
      (globalThis as { Bun?: unknown }).Bun = original;
    }
  });
});
