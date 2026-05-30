import { describe, expect, it } from "vitest";
import { createEnvApi } from "../../api";
import { createEnvState } from "../../state";
import type { EnvState } from "../../types";
import { freezeMap } from "../../validate";

/** Builds a frozen state with the given resolved + public entries for API tests. */
function frozenState(resolved: Record<string, string>, publicKeys: readonly string[]): EnvState {
  const state = createEnvState();
  for (const [key, value] of Object.entries(resolved)) {
    state.resolved.set(key, value);
    if (publicKeys.includes(key)) state.publicMap.set(key, value);
  }
  freezeMap(state.resolved);
  freezeMap(state.publicMap);
  return state;
}

describe("env/api", () => {
  it("get returns the resolved value or undefined", () => {
    const api = createEnvApi({ state: frozenState({ KEY: "value" }, []) });
    expect(api.get("KEY")).toBe("value");
    expect(api.get("MISSING")).toBeUndefined();
  });

  it("require returns the value or throws when undefined", () => {
    const api = createEnvApi({ state: frozenState({ KEY: "value" }, []) });
    expect(api.require("KEY")).toBe("value");
    expect(() => api.require("MISSING")).toThrow(/MISSING/);
  });

  it("has reports presence of a resolved variable", () => {
    const api = createEnvApi({ state: frozenState({ KEY: "value" }, []) });
    expect(api.has("KEY")).toBe(true);
    expect(api.has("MISSING")).toBe(false);
  });

  it("getPublic returns a frozen plain object of public variables", () => {
    const api = createEnvApi({
      state: frozenState({ PUBLIC_URL: "/api", SECRET: "shh" }, ["PUBLIC_URL"])
    });
    const out = api.getPublic();
    expect(out).toEqual({ PUBLIC_URL: "/api" });
    expect(Object.isFrozen(out)).toBe(true);
    expect(() => {
      (out as Record<string, string>).X = "y";
    }).toThrow(TypeError);
  });

  it("getPublic returns a copy, not the raw state map", () => {
    const state = frozenState({ PUBLIC_URL: "/api" }, ["PUBLIC_URL"]);
    const api = createEnvApi({ state });
    const a = api.getPublic();
    const b = api.getPublic();
    expect(a).not.toBe(b);
    expect(a).not.toBe(state.publicMap);
  });

  it("getPublicMap returns the frozen ReadonlyMap of public variables", () => {
    const state = frozenState({ PUBLIC_URL: "/api", SECRET: "shh" }, ["PUBLIC_URL"]);
    const api = createEnvApi({ state });
    const map = api.getPublicMap();
    expect(map.get("PUBLIC_URL")).toBe("/api");
    expect(map.has("SECRET")).toBe(false);
    expect(() => (map as Map<string, string>).set("X", "y")).toThrow(TypeError);
  });
});
