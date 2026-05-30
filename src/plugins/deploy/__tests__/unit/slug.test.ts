import { describe, expect, it } from "vitest";
import { toSlug } from "../../slug";

const CLOUDFLARE_NAME = /^[a-z0-9][a-z0-9-]*$/;

describe("deploy/toSlug", () => {
  it("produces a Cloudflare project-name regex-compliant slug", () => {
    expect(toSlug("My Cool Site!")).toBe("my-cool-site");
    expect(toSlug("My Cool Site!")).toMatch(CLOUDFLARE_NAME);
  });

  it("handles a leading digit/hyphen", () => {
    expect(toSlug("123 Site")).toBe("123-site");
    expect(toSlug("-leading hyphen")).toBe("leading-hyphen");
    expect(toSlug("-leading hyphen")).toMatch(CLOUDFLARE_NAME);
  });

  it("handles all-symbol input", () => {
    expect(toSlug("!!!")).toBe("site");
    expect(toSlug("   ")).toBe("site");
    expect(toSlug("")).toBe("site");
    expect(toSlug("!!!")).toMatch(CLOUDFLARE_NAME);
  });

  it("truncates over-length names to <= 58 chars", () => {
    const long = "a".repeat(120);
    const slug = toSlug(long);
    expect(slug.length).toBeLessThanOrEqual(58);
    expect(slug).toMatch(CLOUDFLARE_NAME);
    // A name that truncates onto a hyphen must not end with one.
    const trailing = `${"a".repeat(57)}---b`;
    expect(toSlug(trailing).endsWith("-")).toBe(false);
  });

  it("collapses unicode/whitespace", () => {
    expect(toSlug("Açaí Café")).toBe("acai-cafe");
    expect(toSlug("a   b\t\nc")).toBe("a-b-c");
    expect(toSlug("a___b   c")).toBe("a-b-c");
  });
});
