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
      progressBar: true,
      islands: []
    });
  });
});
