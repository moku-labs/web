// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureTeardown, disposeSpa } from "../../lifecycle";
import type { SpaContext, SpaKernel } from "../../types";

const makeKernel = (dispose: () => void): SpaKernel => ({
  init() {},
  boot() {},
  register() {},
  processNav() {},
  scan() {},
  dispose
});

const makeCtx = (log: unknown, kernel: SpaKernel | null) =>
  ({ log, state: { kernel } }) as unknown as SpaContext;

afterEach(() => {
  vi.restoreAllMocks();
  disposeSpa(); // idempotent reset
});

describe("lifecycle capture/dispose", () => {
  it("captureTeardown + disposeSpa runs the captured kernel.dispose()", () => {
    const dispose = vi.fn();
    captureTeardown(makeCtx({ error: vi.fn() }, makeKernel(dispose)));
    disposeSpa();
    expect(dispose).toHaveBeenCalledTimes(1);
    // Idempotent: a second dispose is a no-op (teardown was nulled).
    disposeSpa();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("logs via the captured ref when teardown throws", () => {
    const error = vi.fn();
    const kernel = makeKernel(() => {
      throw new Error("boom");
    });
    captureTeardown(makeCtx({ error }, kernel));
    expect(() => disposeSpa()).not.toThrow();
    expect(error).toHaveBeenCalledWith("spa:teardown-failed", {}, expect.any(Error));
  });

  it("captureTeardown is a no-op without a DOM", () => {
    const original = globalThis.document;
    const dispose = vi.fn();
    // @ts-expect-error — simulate a headless environment.
    delete globalThis.document;
    expect(() => captureTeardown(makeCtx({ error: vi.fn() }, makeKernel(dispose)))).not.toThrow();
    globalThis.document = original;
    // Nothing was captured → dispose is a no-op.
    disposeSpa();
    expect(dispose).not.toHaveBeenCalled();
  });
});
