import { describe, expect, it } from "vitest";
import { createEnvState } from "../../state";

describe("env/state", () => {
  it("createEnvState returns empty resolved and publicMap maps", () => {
    const state = createEnvState();
    expect(state.resolved).toBeInstanceOf(Map);
    expect(state.publicMap).toBeInstanceOf(Map);
    expect(state.resolved.size).toBe(0);
    expect(state.publicMap.size).toBe(0);
  });

  it("each createEnvState call returns independent maps", () => {
    const a = createEnvState();
    const b = createEnvState();
    expect(a.resolved).not.toBe(b.resolved);
    expect(a.publicMap).not.toBe(b.publicMap);
    a.resolved.set("KEY", "value");
    expect(b.resolved.has("KEY")).toBe(false);
  });
});
