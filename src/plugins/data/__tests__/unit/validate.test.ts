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
});
