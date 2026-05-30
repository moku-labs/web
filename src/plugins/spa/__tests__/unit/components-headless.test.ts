// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  notifyNavEnd,
  notifyNavStart,
  scanAndMount,
  unmountAll,
  unmountPageSpecific
} from "../../components";
import { createState } from "../../state";

/** Fresh state with one page-specific instance preloaded (no DOM needed). */
function stateWithInstance() {
  const state = createState({ global: {}, config: {} });
  const calls: string[] = [];
  const el = { tagName: "DIV" } as unknown as Element;
  state.instances.set(el, {
    def: {
      name: "x",
      hooks: {
        onUnMount: () => calls.push("onUnMount"),
        onDestroy: () => calls.push("onDestroy"),
        onNavStart: () => calls.push("onNavStart"),
        onNavEnd: () => calls.push("onNavEnd")
      }
    },
    el,
    persistent: true
  });
  return { state, calls };
}

describe("components are headless-safe (no document)", () => {
  it("scanAndMount is a no-op without a DOM", () => {
    const state = createState({ global: {}, config: {} });
    expect(() => scanAndMount(state, vi.fn(), "main > section")).not.toThrow();
    expect(state.instances.size).toBe(0);
  });

  it("unmount/notify helpers run against preloaded instances without a DOM", () => {
    const { state, calls } = stateWithInstance();
    const emit = vi.fn();
    notifyNavStart(state);
    notifyNavEnd(state);
    unmountPageSpecific(state, emit); // persistent → skipped, instance remains
    expect(state.instances.size).toBe(1);
    unmountAll(state, emit);
    expect(state.instances.size).toBe(0);
    expect(calls).toEqual(["onNavStart", "onNavEnd", "onUnMount", "onDestroy"]);
  });
});
