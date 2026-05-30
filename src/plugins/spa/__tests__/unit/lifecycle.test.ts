// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kernelRef } from "../../kernel";
import { captureTeardown, disposeSpa } from "../../lifecycle";
import type { SpaContext } from "../../types";

const makeCtx = (log: unknown) => ({ log }) as unknown as SpaContext;

afterEach(() => {
  delete kernelRef.current;
  vi.restoreAllMocks();
  disposeSpa(); // idempotent reset
});

beforeEach(() => {
  delete kernelRef.current;
});

describe("lifecycle capture/dispose", () => {
  it("captureTeardown + disposeSpa runs the captured kernel.dispose()", () => {
    const dispose = vi.fn();
    kernelRef.current = {
      init() {},
      boot() {},
      register() {},
      processNav() {},
      scan() {},
      dispose
    };
    captureTeardown(makeCtx({ error: vi.fn() }));
    disposeSpa();
    expect(dispose).toHaveBeenCalledTimes(1);
    // Idempotent: a second dispose is a no-op (teardown was nulled).
    disposeSpa();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("logs via the captured ref when teardown throws", () => {
    const error = vi.fn();
    kernelRef.current = {
      init() {},
      boot() {},
      register() {},
      processNav() {},
      scan() {},
      dispose() {
        throw new Error("boom");
      }
    };
    captureTeardown(makeCtx({ error }));
    expect(() => disposeSpa()).not.toThrow();
    expect(error).toHaveBeenCalledWith("spa:teardown-failed", {}, expect.any(Error));
  });

  it("captureTeardown is a no-op without a DOM", () => {
    const original = globalThis.document;
    // @ts-expect-error — simulate a headless environment.
    delete globalThis.document;
    expect(() => captureTeardown(makeCtx({ error: vi.fn() }))).not.toThrow();
    globalThis.document = original;
    // Nothing was captured → dispose is a no-op.
    const dispose = vi.fn();
    kernelRef.current = {
      init() {},
      boot() {},
      register() {},
      processNav() {},
      scan() {},
      dispose
    };
    disposeSpa();
    expect(dispose).not.toHaveBeenCalled();
  });
});
