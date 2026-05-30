import { describe, expect, it } from "vitest";
import { createEnvState } from "../../state";
import type { EnvConfig, EnvProvider, EnvState } from "../../types";
import { freezeMap, validateSchema } from "../../validate";

/** Builds an in-memory provider from a flat record. */
function fakeProvider(name: string, values: Record<string, string | undefined>): EnvProvider {
  return { name, load: () => values };
}

/** Builds a core-plugin context (`{ config, state }`) for validateSchema. */
function makeCtx(config: Partial<EnvConfig>): { config: EnvConfig; state: EnvState } {
  return {
    config: { schema: {}, providers: [], publicPrefix: "PUBLIC_", ...config },
    state: createEnvState()
  };
}

describe("env/validate", () => {
  it("merges providers first-non-undefined-wins in array order", () => {
    const ctx = makeCtx({
      schema: { KEY: { public: false } },
      providers: [
        fakeProvider("first", { KEY: "winner" }),
        fakeProvider("second", { KEY: "loser" })
      ]
    });
    validateSchema(ctx);
    expect(ctx.state.resolved.get("KEY")).toBe("winner");
  });

  it("coerces empty-string values to undefined before precedence", () => {
    const ctx = makeCtx({
      schema: { KEY: { public: false } },
      providers: [fakeProvider("first", { KEY: "" }), fakeProvider("second", { KEY: "fallback" })]
    });
    validateSchema(ctx);
    expect(ctx.state.resolved.get("KEY")).toBe("fallback");
  });

  it("throws when public:true on a non-PUBLIC_ key", () => {
    const ctx = makeCtx({ schema: { API_URL: { public: true } } });
    expect(() => validateSchema(ctx)).toThrow(/API_URL/);
  });

  it("throws when a PUBLIC_-named key lacks public:true", () => {
    const ctx = makeCtx({ schema: { PUBLIC_API_URL: { public: false } } });
    expect(() => validateSchema(ctx)).toThrow(/PUBLIC_API_URL/);
  });

  it("respects a custom publicPrefix", () => {
    const ok = makeCtx({
      publicPrefix: "VITE_",
      schema: { VITE_X: { public: true, default: "v" } }
    });
    expect(() => validateSchema(ok)).not.toThrow();
    expect(ok.state.publicMap.get("VITE_X")).toBe("v");

    const bad = makeCtx({ publicPrefix: "VITE_", schema: { PUBLIC_X: { public: true } } });
    expect(() => validateSchema(bad)).toThrow(/PUBLIC_X/);
  });

  it("applies defaults only when a key is unresolved", () => {
    const ctx = makeCtx({
      schema: { A: { public: false, default: "dflt" }, B: { public: false, default: "dflt" } },
      providers: [fakeProvider("p", { A: "live" })]
    });
    validateSchema(ctx);
    expect(ctx.state.resolved.get("A")).toBe("live");
    expect(ctx.state.resolved.get("B")).toBe("dflt");
  });

  it("throws naming the variable when a required key has no value", () => {
    const ctx = makeCtx({ schema: { SESSION_SECRET: { public: false, required: true } } });
    expect(() => validateSchema(ctx)).toThrow(/SESSION_SECRET/);
  });

  it("populates resolved and publicMap then freezes both", () => {
    const ctx = makeCtx({
      schema: {
        PUBLIC_URL: { public: true, default: "/api" },
        SECRET: { public: false, default: "shh" }
      }
    });
    validateSchema(ctx);
    expect(ctx.state.resolved.get("PUBLIC_URL")).toBe("/api");
    expect(ctx.state.resolved.get("SECRET")).toBe("shh");
    expect(ctx.state.publicMap.get("PUBLIC_URL")).toBe("/api");
    expect(ctx.state.publicMap.has("SECRET")).toBe(false);
    expect(() => ctx.state.resolved.set("X", "y")).toThrow(TypeError);
    expect(() => ctx.state.publicMap.set("X", "y")).toThrow(TypeError);
  });

  it("does not include schema keys that resolved to undefined", () => {
    const ctx = makeCtx({ schema: { OPTIONAL: { public: false } } });
    validateSchema(ctx);
    expect(ctx.state.resolved.has("OPTIONAL")).toBe(false);
  });

  it("resolves non-schema provider keys (dynamic keys) into resolved, not publicMap", () => {
    const ctx = makeCtx({
      schema: { DECLARED: { public: false } },
      providers: [fakeProvider("p", { DECLARED: "a", DYNAMIC: "b" })]
    });
    validateSchema(ctx);
    expect(ctx.state.resolved.get("DYNAMIC")).toBe("b");
    expect(ctx.state.publicMap.has("DYNAMIC")).toBe(false);
  });

  it("freezeMap makes set/clear/delete throw", () => {
    const map = new Map<string, string>([["K", "v"]]);
    freezeMap(map);
    expect(() => map.set("X", "y")).toThrow(TypeError);
    expect(() => map.clear()).toThrow(TypeError);
    expect(() => map.delete("K")).toThrow(TypeError);
    expect(map.get("K")).toBe("v");
  });

  it("freezeMap throws the canonical frozen message", () => {
    const map = new Map<string, string>();
    freezeMap(map);
    expect(() => map.set("X", "y")).toThrow("env: map is frozen and cannot be mutated");
  });

  it("freezeMap mutator redefinitions are non-configurable", () => {
    const map = new Map<string, string>();
    freezeMap(map);
    expect(() => Object.defineProperty(map, "set", { value: () => undefined })).toThrow(TypeError);
  });
});
