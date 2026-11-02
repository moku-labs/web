// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createState, defaultSpaConfig, resolveSpaConfig } from "../../state";

describe("createState (headless / node)", () => {
  it("returns fresh empty state seeded from defaults", () => {
    const state = createState({ global: {}, config: defaultSpaConfig });
    expect(state.registeredIslands.size).toBe(0);
    expect(state.instances.size).toBe(0);
    expect(state.currentUrl).toBe("");
    expect(state.destroyRouter).toBeNull();
    expect(state.started).toBe(false);
    expect(state.kernel).toBeNull();
    expect(state.prefetch).toBeNull();
  });
});

describe("resolveSpaConfig (headless / node — selector check is permissive)", () => {
  it("accepts a selector without a DOM to validate against", () => {
    // No `document` in node: isValidSelector short-circuits to true.
    expect(resolveSpaConfig({ swapSelector: "main > section" }).swapSelector).toBe(
      "main > section"
    );
  });

  it("still rejects an empty selector even when headless", () => {
    expect(() => resolveSpaConfig({ swapSelector: "" })).toThrow(/non-empty string/);
  });

  it("applies all defaults", () => {
    expect(resolveSpaConfig({})).toEqual({
      swapSelector: "main > section",
      viewTransitions: false,
      defaultTransition: "none",
      scrollRestoration: "top",
      progressBar: true,
      islands: [],
      prefetch: false
    });
  });

  it("maps viewTransitions: true → enabled crossfade default", () => {
    const r = resolveSpaConfig({ viewTransitions: true });
    expect(r.viewTransitions).toBe(true);
    expect(r.defaultTransition).toBe("crossfade");
  });

  it("maps a named viewTransitions mode → enabled + that default", () => {
    const r = resolveSpaConfig({ viewTransitions: "slide" });
    expect(r.viewTransitions).toBe(true);
    expect(r.defaultTransition).toBe("slide");
  });

  it("maps viewTransitions: 'none' → disabled", () => {
    const r = resolveSpaConfig({ viewTransitions: "none" });
    expect(r.viewTransitions).toBe(false);
    expect(r.defaultTransition).toBe("none");
  });

  it("carries the scrollRestoration default through (top), overridable to preserve", () => {
    expect(resolveSpaConfig({}).scrollRestoration).toBe("top");
    expect(resolveSpaConfig({ scrollRestoration: "preserve" }).scrollRestoration).toBe("preserve");
  });
});

describe("resolveSpaConfig — prefetch", () => {
  // Bug: opting in does nothing, because the resolver drops a valid mode.
  it("keeps the intent and visible modes", () => {
    expect(resolveSpaConfig({ prefetch: "intent" }).prefetch).toBe("intent");
    expect(resolveSpaConfig({ prefetch: "visible" }).prefetch).toBe("visible");
  });

  // Bug: a typo silently disables the feature.
  it('throws the Part-3 error on prefetch: "hover"', () => {
    const config = { prefetch: "hover" } as unknown as Parameters<typeof resolveSpaConfig>[0];
    expect(() => resolveSpaConfig(config)).toThrow(
      '[web] spa.prefetch must be false, "intent" or "visible". Got "hover".\n  Set spa.prefetch to one of the allowed values, or leave it out.'
    );
  });
});
