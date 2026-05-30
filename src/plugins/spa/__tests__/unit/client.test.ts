// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api as HeadApi } from "../../../head/types";
import type { RouterApi } from "../../../router/types";
import { boot, createClientState, navigate } from "../../client";
import type { SpaKernelDeps } from "../../types";

const deps: SpaKernelDeps = {
  router: {} as RouterApi,
  head: { render: () => "" } as unknown as HeadApi
};

beforeEach(() => {
  document.body.innerHTML = `<main><section id="page">home</section></main>`;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("client entry", () => {
  it("createClientState returns fresh empty state", () => {
    const state = createClientState();
    expect(state.registeredComponents.size).toBe(0);
    expect(state.instances.size).toBe(0);
    expect(state.started).toBe(false);
    expect(state.kernel).toBeNull();
  });

  it("boot builds the kernel, runs init, and boots the runtime", () => {
    const state = createClientState();
    boot(state, { progressBar: false }, deps);
    expect(state.kernel).not.toBeNull();
    expect(state.started).toBe(true);
    state.kernel?.dispose();
  });

  it("navigate delegates to the booted kernel (no-op when not booted)", () => {
    const state = createClientState();
    expect(() => navigate(state, "/about")).not.toThrow();
    boot(state, { progressBar: false }, deps);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("<main><section id='page'>x</section></main>", { status: 200 })
        )
      )
    );
    expect(() => navigate(state, "/about")).not.toThrow();
    state.kernel?.dispose();
  });

  it("boot forwards events to a supplied emit", async () => {
    const state = createClientState();
    const emit = vi.fn();
    boot(state, { progressBar: false }, deps, emit);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("<main><section id='page'>x</section></main>", { status: 200 })
        )
      )
    );
    navigate(state, "/about");
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith("spa:navigated", { url: "/about" }));
    state.kernel?.dispose();
  });
});
