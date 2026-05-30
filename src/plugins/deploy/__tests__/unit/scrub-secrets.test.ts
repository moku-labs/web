import { describe, it } from "vitest";

describe("deploy/scrubSecrets", () => {
  it.todo("masks a high-entropy 16+ char token with ***");
  it.todo("preserves low-entropy and short tokens");
  it.todo("preserves the allowlisted CLOUDFLARE_ACCOUNT_ID substring");
  it.todo("preserves an error `code` property when scrubbing a rethrown message");
});
