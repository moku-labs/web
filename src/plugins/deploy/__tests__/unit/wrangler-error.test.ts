import { describe, expect, it } from "vitest";
import { classifyWranglerError } from "../../wrangler";

describe("deploy/classifyWranglerError", () => {
  it("maps project-not-found to ERR_DEPLOY_PROJECT_NOT_FOUND", () => {
    const { code, message } = classifyWranglerError(
      1,
      "✘ [ERROR] Could not find project with name my-site"
    );
    expect(code).toBe("ERR_DEPLOY_PROJECT_NOT_FOUND");
    expect(message).toMatch(/init|dashboard/i);
  });

  it("maps jwt/expired to ERR_DEPLOY_AUTH_EXPIRED", () => {
    expect(classifyWranglerError(1, "Error: JWT validation failed").code).toBe(
      "ERR_DEPLOY_AUTH_EXPIRED"
    );
    expect(classifyWranglerError(1, "your session expired").code).toBe("ERR_DEPLOY_AUTH_EXPIRED");
  });

  it("maps auth/unauthorized/permission to ERR_DEPLOY_AUTH", () => {
    expect(classifyWranglerError(1, "401 Unauthorized").code).toBe("ERR_DEPLOY_AUTH");
    expect(classifyWranglerError(1, "permission denied for token").code).toBe("ERR_DEPLOY_AUTH");
  });

  it("maps network failures to ERR_DEPLOY_NETWORK", () => {
    expect(classifyWranglerError(1, "fetch failed: ENOTFOUND api.cloudflare.com").code).toBe(
      "ERR_DEPLOY_NETWORK"
    );
    expect(classifyWranglerError(1, "request ETIMEDOUT").code).toBe("ERR_DEPLOY_NETWORK");
  });

  it("maps any other non-zero exit to ERR_DEPLOY_WRANGLER_FAILED", () => {
    const { code, message } = classifyWranglerError(2, "some unrecognized failure detail");
    expect(code).toBe("ERR_DEPLOY_WRANGLER_FAILED");
    // The scrubbed stderr tail is surfaced.
    expect(message).toContain("some unrecognized failure detail");
  });
});
