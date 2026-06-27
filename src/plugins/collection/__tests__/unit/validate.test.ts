import { describe, expect, it } from "vitest";
import type { CollectionConfig } from "../../types";
import { validateCollectionConfig } from "../../validate";

/** A valid baseline config the per-field cases mutate. */
const VALID: CollectionConfig = { baseUrl: "/" };

describe("validateCollectionConfig()", () => {
  it("accepts the default config", () => {
    expect(() => validateCollectionConfig(VALID)).not.toThrow();
  });

  it("accepts a multi-segment prefix ending with /", () => {
    expect(() => validateCollectionConfig({ baseUrl: "/cdn/" })).not.toThrow();
  });

  it("throws [web] collection.baseUrl: ... for a prefix not ending with /", () => {
    expect(() => validateCollectionConfig({ ...VALID, baseUrl: "/cdn" })).toThrow(
      /\[web\] collection\.baseUrl:/
    );
  });

  it("throws [web] collection.baseUrl: ... for an empty baseUrl", () => {
    expect(() => validateCollectionConfig({ ...VALID, baseUrl: "" })).toThrow(
      /\[web\] collection\.baseUrl:/
    );
  });
});
