import { describe, expect, it } from "vitest";
import { dataSuffix, relativeDataFile } from "../../convention";

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

  it("keeps the page URL's percent-encoding (the browser fetches the encoded path)", () => {
    expect(dataSuffix("/uk/tags/c%23%20tips/")).toBe("uk/tags/c%23%20tips/index.json");
  });
});

describe("relativeDataFile() — the page-path → on-disk file convention", () => {
  it("joins the trimmed output dir with the suffix", () => {
    expect(relativeDataFile("_data", "/en/hello/")).toBe("_data/en/hello/index.json");
    expect(relativeDataFile("_data/", "/")).toBe("_data/index.json");
  });

  it("decodes percent-escapes so the file matches the decoded request path", () => {
    expect(relativeDataFile("_data", "/uk/tags/c%23%20tips%20%26%20tricks/")).toBe(
      "_data/uk/tags/c# tips & tricks/index.json"
    );
  });

  it("keeps a malformed escape raw instead of throwing", () => {
    expect(relativeDataFile("_data", "/en/100%/")).toBe("_data/en/100%/index.json");
  });
});
