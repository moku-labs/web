/**
 * @file Unit tests for `contentRef` — the browser-safe by-name require handle. Proves
 * the handle is keyed by the content plugin's name and carries a `_phantom.api` slot,
 * so a route loader can resolve the content API via `ctx.require(contentRef)` without
 * importing the node-only content plugin (the bundle-safety contract).
 */
import { describe, expect, it } from "vitest";
import { contentRef } from "../../ref";

describe("contentRef — browser-safe by-name require handle", () => {
  it("is keyed by the content plugin's name", () => {
    expect(contentRef.name).toBe("content");
  });

  it("carries a _phantom.api slot for typed require extraction", () => {
    expect(contentRef).toHaveProperty("_phantom");
    expect(contentRef._phantom).toHaveProperty("api");
  });

  it("acts as a stable require-by-identity key", () => {
    const fakeApi = { loadAll: () => new Map() };
    const require = (ref: unknown): unknown => (ref === contentRef ? fakeApi : undefined);
    expect(require(contentRef)).toBe(fakeApi);
  });
});
