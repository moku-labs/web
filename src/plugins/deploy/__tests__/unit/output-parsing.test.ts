import { describe, expect, it } from "vitest";
import { parseDeploymentId, parseDeployUrl } from "../../wrangler";

const STDOUT = [
  "✨ Success! Uploaded 12 files",
  "Deployment complete! Take a peek over at https://my-site.pages.dev",
  "Deployment ID: 1a2b3c4d-5e6f-7a8b-9c0d-112233445566"
].join("\n");

describe("deploy/output parsing", () => {
  it("extracts the *.pages.dev URL from wrangler stdout", () => {
    expect(parseDeployUrl(STDOUT)).toBe("https://my-site.pages.dev");
    expect(parseDeployUrl("see https://a-b-c-123.pages.dev now")).toBe(
      "https://a-b-c-123.pages.dev"
    );
  });

  it("extracts the deployment ID from wrangler stdout", () => {
    expect(parseDeploymentId(STDOUT)).toBe("1a2b3c4d-5e6f-7a8b-9c0d-112233445566");
    expect(parseDeploymentId("Deployment ID: deadbeef")).toBe("deadbeef");
  });

  it("returns empty strings on empty or garbled output", () => {
    expect(parseDeployUrl("")).toBe("");
    expect(parseDeploymentId("")).toBe("");
    expect(parseDeployUrl("no url here, just noise")).toBe("");
    expect(parseDeploymentId("no id present")).toBe("");
    // A non-pages.dev URL is not matched.
    expect(parseDeployUrl("https://example.com")).toBe("");
  });
});
