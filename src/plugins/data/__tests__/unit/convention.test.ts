import { describe, expect, it } from "vitest";
import { dataSuffix } from "../../convention";

describe("dataSuffix() — the pure page-path → data-file convention", () => {
  it("mirrors a nested page path into <path>/index.json", () => {
    expect(dataSuffix("/en/hello/")).toBe("en/hello/index.json");
  });

  it("collapses the root path to index.json", () => {
    expect(dataSuffix("/")).toBe("index.json");
    expect(dataSuffix("")).toBe("index.json");
  });

  it("normalizes a missing trailing slash and a leading slash", () => {
    expect(dataSuffix("/en/hello")).toBe("en/hello/index.json");
    expect(dataSuffix("en/hello/")).toBe("en/hello/index.json");
  });

  it("strips a query string so the file key is stable", () => {
    expect(dataSuffix("/en/hello/?page=2")).toBe("en/hello/index.json");
  });
});
