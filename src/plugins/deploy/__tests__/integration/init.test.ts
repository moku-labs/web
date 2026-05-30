import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeScaffolding } from "../../init";
import { makeConfig } from "../helpers";

describe("deploy init integration", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "deploy-init-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes wrangler.jsonc (+ deploy.yml when ci) in a fresh temp dir", async () => {
    const result = await writeScaffolding({
      config: makeConfig(),
      slug: "my-site",
      cwd: tmp,
      options: { ci: true }
    });
    expect(result.written).toContain("wrangler.jsonc");
    expect(result.written).toContain(".github/workflows/deploy.yml");
    expect(existsSync(path.join(tmp, "wrangler.jsonc"))).toBe(true);
    expect(existsSync(path.join(tmp, ".github", "workflows", "deploy.yml"))).toBe(true);
  });

  it("derives the slug from a stubbed site.name()", async () => {
    await writeScaffolding({
      config: makeConfig(),
      slug: "my-cool-site",
      cwd: tmp,
      options: {}
    });
    const contents = readFileSync(path.join(tmp, "wrangler.jsonc"), "utf8");
    expect(contents).toContain('"name": "my-cool-site"');
  });

  it("is idempotent — never overwrites an existing wrangler.jsonc", async () => {
    const existing = '{ "name": "hand-written" }\n';
    writeFileSync(path.join(tmp, "wrangler.jsonc"), existing, "utf8");
    const result = await writeScaffolding({
      config: makeConfig(),
      slug: "my-site",
      cwd: tmp,
      options: {}
    });
    expect(result.skipped).toContain("wrangler.jsonc");
    expect(result.written).not.toContain("wrangler.jsonc");
    // Untouched on disk.
    expect(readFileSync(path.join(tmp, "wrangler.jsonc"), "utf8")).toBe(existing);
  });

  it("reports drift in check mode without writing", async () => {
    writeFileSync(path.join(tmp, "wrangler.jsonc"), '{ "name": "drifted" }\n', "utf8");
    const result = await writeScaffolding({
      config: makeConfig(),
      slug: "my-site",
      cwd: tmp,
      options: { check: true }
    });
    expect(result.drifted).toContain("wrangler.jsonc");
    expect(result.written).toHaveLength(0);
    // The file is left exactly as it was.
    expect(readFileSync(path.join(tmp, "wrangler.jsonc"), "utf8")).toBe('{ "name": "drifted" }\n');
  });
});
