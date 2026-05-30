import { describe, it } from "vitest";

describe("deploy/classifyWranglerError", () => {
  it.todo("maps project-not-found to ERR_DEPLOY_PROJECT_NOT_FOUND");
  it.todo("maps jwt/expired to ERR_DEPLOY_AUTH_EXPIRED");
  it.todo("maps auth/unauthorized/permission to ERR_DEPLOY_AUTH");
  it.todo("maps network failures to ERR_DEPLOY_NETWORK");
  it.todo("maps any other non-zero exit to ERR_DEPLOY_WRANGLER_FAILED");
});
