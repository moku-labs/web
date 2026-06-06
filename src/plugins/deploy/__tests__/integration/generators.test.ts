import { describe, expect, it } from "vitest";
import { generateGithubWorkflow } from "../../generators/github-workflow";
import { generateWranglerConfig } from "../../generators/wrangler-config";
import { MOKU_WRANGLER_VERSION } from "../../wrangler";

describe("deploy generators integration", () => {
  it("snapshots wrangler.jsonc from slug + outDir + compatibilityDate", () => {
    const out = generateWranglerConfig({
      slug: "my-site",
      outDir: "dist",
      compatibilityDate: "2024-01-01"
    });
    expect(out).toMatchSnapshot();
  });

  it("snapshots deploy.yml with SHA-pinned actions", () => {
    const out = generateGithubWorkflow({ slug: "my-site" });
    expect(out).toMatchSnapshot();
    // Actions are SHA-pinned (40-hex) — never floating tags like @v4.
    expect(out).toMatch(/actions\/checkout@[a-f0-9]{40} # v/);
    expect(out).toMatch(/oven-sh\/setup-bun@[a-f0-9]{40} # v/);
    expect(out).not.toMatch(/uses: \S+@v\d+\s*$/m);
  });

  it("emits a single MOKU_WRANGLER_VERSION source of truth in deploy.yml", () => {
    const out = generateGithubWorkflow({ slug: "my-site" });
    expect(out).toContain(`wranglerVersion: "${MOKU_WRANGLER_VERSION}"`);
  });

  it("varies the on: trigger by WorkflowTrigger (default auto = push to main)", () => {
    const auto = generateGithubWorkflow({ slug: "my-site", trigger: "auto" });
    expect(auto).toContain("push:\n    branches: [main]");
    expect(auto).toContain("workflow_dispatch:");
    // Default is auto.
    expect(generateGithubWorkflow({ slug: "my-site" })).toBe(auto);

    const tagged = generateGithubWorkflow({ slug: "my-site", trigger: "versioned-tag" });
    expect(tagged).toContain('push:\n    tags: ["v*"]');
    expect(tagged).toContain("workflow_dispatch:");
    expect(tagged).not.toContain("branches: [main]");

    const dispatch = generateGithubWorkflow({ slug: "my-site", trigger: "dispatch" });
    expect(dispatch).toContain("on:\n  workflow_dispatch:");
    expect(dispatch).not.toContain("push:");
  });
});
