import { describe, expect, it } from "vitest";
import type { DataConfig } from "../../types";
import { validateDataConfig } from "../../validate";

/** A valid baseline config the per-field cases mutate. */
const VALID: DataConfig = { outputDir: "_data", baseUrl: "/_data/", payload: "fragment" };

describe("validateDataConfig()", () => {
  it("accepts the default config", () => {
    expect(() => validateDataConfig(VALID)).not.toThrow();
  });

  it('accepts payload "data"', () => {
    expect(() => validateDataConfig({ ...VALID, payload: "data" })).not.toThrow();
  });

  it("throws [web] data.payload: ... for an invalid payload (G-1)", () => {
    // @ts-expect-error — exercising the runtime guard with an invalid literal
    expect(() => validateDataConfig({ ...VALID, payload: "html" })).toThrow(
      /\[web\] data\.payload:/
    );
  });

  it("throws [web] data.baseUrl: ... for a non-rooted baseUrl (G-1)", () => {
    expect(() => validateDataConfig({ ...VALID, baseUrl: "_data/" })).toThrow(
      /\[web\] data\.baseUrl:/
    );
  });

  it("throws [web] data.baseUrl: ... for an empty baseUrl", () => {
    expect(() => validateDataConfig({ ...VALID, baseUrl: "" })).toThrow(/\[web\] data\.baseUrl:/);
  });
});
