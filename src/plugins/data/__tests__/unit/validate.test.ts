import { describe, expect, it } from "vitest";
import type { DataConfig } from "../../types";
import { validateDataConfig } from "../../validate";

/** A valid baseline config the per-field cases mutate. */
const VALID: DataConfig = { outputDir: "_data", baseUrl: "/_data/" };

describe("validateDataConfig()", () => {
  it("accepts the default config", () => {
    expect(() => validateDataConfig(VALID)).not.toThrow();
  });

  it("throws [web] data.baseUrl: ... for a non-rooted baseUrl", () => {
    expect(() => validateDataConfig({ ...VALID, baseUrl: "_data/" })).toThrow(
      /\[web\] data\.baseUrl:/
    );
  });

  it("throws [web] data.baseUrl: ... for an empty baseUrl", () => {
    expect(() => validateDataConfig({ ...VALID, baseUrl: "" })).toThrow(/\[web\] data\.baseUrl:/);
  });

  // Bug: a typo like preload: "al" is accepted and the site silently never preloads.
  it("throws [web] data.preload: ... with a fix line for an unknown value", () => {
    const bad = { ...VALID, preload: "al" } as unknown as DataConfig;
    expect(() => validateDataConfig(bad)).toThrow(/\[web\] data\.preload:[\s\S]*\n {2}Set /);
  });

  // Bug: the new field breaks configs that never set it, or rejects the two real values.
  it("accepts preload unset, 'none' and 'all'", () => {
    expect(() => validateDataConfig({ ...VALID, preload: "none" })).not.toThrow();
    expect(() => validateDataConfig({ ...VALID, preload: "all" })).not.toThrow();
  });
});
