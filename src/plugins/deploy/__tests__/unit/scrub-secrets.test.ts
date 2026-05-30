import { describe, expect, it } from "vitest";
import { deployError, scrubSecrets } from "../../wrangler";

describe("deploy/scrubSecrets", () => {
  it("masks a high-entropy 16+ char token with ***", () => {
    // 32-char mixed-case alphanumeric token: long + high entropy.
    const token = ["HZ8kQ2mWp9Lx4Tn", "6Rv3Bd7Yc1Fg5Js"].join("");
    const out = scrubSecrets(`warning: token ${token} used`, []);
    expect(out).not.toContain(token);
    expect(out).toContain("***");
  });

  it("preserves low-entropy and short tokens", () => {
    // Short token (< 16 chars) is preserved even if mixed.
    expect(scrubSecrets("deploy to main now", [])).toBe("deploy to main now");
    // Long but low-entropy (single repeated char) is preserved.
    const lowEntropy = "aaaaaaaaaaaaaaaaaaaaaaaa";
    expect(scrubSecrets(`value ${lowEntropy} ok`, [])).toContain(lowEntropy);
  });

  it("preserves the allowlisted CLOUDFLARE_ACCOUNT_ID substring", () => {
    const accountId = "CLOUDFLARE_ACCOUNT_ID=abcdef0123456789abcdef";
    const out = scrubSecrets(`using ${accountId} now`, ["CLOUDFLARE_ACCOUNT_ID"]);
    expect(out).toContain(accountId);
  });

  it("preserves an error `code` property when scrubbing a rethrown message", () => {
    const token = ["HZ8kQ2mWp9Lx4Tn", "6Rv3Bd7Yc1Fg5Js"].join("");
    const original = deployError("ERR_DEPLOY_WRANGLER_FAILED", `boom ${token}`);
    // Re-wrap with a scrubbed message but carry the code forward.
    const scrubbed = deployError(original.code, scrubSecrets(original.message, []));
    expect(scrubbed.code).toBe("ERR_DEPLOY_WRANGLER_FAILED");
    expect(scrubbed.message).not.toContain(token);
    expect(scrubbed.message).toContain("***");
  });
});
