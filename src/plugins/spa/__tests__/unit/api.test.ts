import { describe, expect, it, vi } from "vitest";
import { createApi } from "../../api";
import { createState } from "../../state";
import type { SpaContext } from "../../types";

/** Build a minimal SpaContext with a spy log + a stub kernel on state. */
function makeCtx() {
  const state = createState({ global: {}, config: {} });
  const register = vi.fn();
  const processNav = vi.fn();
  state.kernel = {
    init() {},
    boot() {},
    register,
    processNav,
    scan() {},
    dispose() {}
  };
  const log = { warn: vi.fn() } as unknown as SpaContext["log"];
  const ctx = { state, log } as unknown as SpaContext;
  return { ctx, state, register, processNav, log };
}

describe("spa api", () => {
  it("register delegates to the kernel and warns on a name collision", () => {
    const { ctx, state, register, log } = makeCtx();
    const def = { name: "c", hooks: {} };
    createApi(ctx).register(def);
    expect(register).toHaveBeenCalledWith(def);
    expect(log.warn).not.toHaveBeenCalled();

    // Second registration of the same name warns.
    state.registeredIslands.set("c", def);
    createApi(ctx).register(def);
    expect(log.warn).toHaveBeenCalledWith("spa:island-collision", { name: "c" });
  });

  it("navigate delegates to the kernel and current reads state", () => {
    const { ctx, state, processNav } = makeCtx();
    const api = createApi(ctx);
    api.navigate("/about");
    expect(processNav).toHaveBeenCalledWith("/about");
    state.currentUrl = "/now";
    expect(api.current()).toBe("/now");
  });
});
