import { describe, it } from "vitest";

describe("deploy/buildWranglerArgs", () => {
  it.todo("assembles the correct argv array (no shell)");
  it.todo("rejects branch '--config' with ERR_DEPLOY_INVALID_BRANCH");
  it.todo("rejects branch '; rm' / spaces with ERR_DEPLOY_INVALID_BRANCH");
  it.todo("accepts a valid 'preview/landing' branch");
  it.todo("rejects an outDir resolving outside root with ERR_DEPLOY_PATH_TRAVERSAL");
});
