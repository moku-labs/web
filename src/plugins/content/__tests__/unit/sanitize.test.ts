import { describe, expect, it } from "vitest";
import { buildSanitizeSchema } from "../../pipeline/sanitize";

describe("content/pipeline/sanitize", () => {
  it("allowlists pull-quote and section-divider classes", () => {
    const schema = buildSanitizeSchema();
    const attrs = schema.attributes ?? {};
    // class allowance lives on aside/div/span for our directive output.
    const asideClasses = attrs.aside ?? [];
    const divClasses = attrs.div ?? [];
    const spanClasses = attrs.span ?? [];
    const flat = JSON.stringify([asideClasses, divClasses, spanClasses]);
    expect(flat).toContain("pull-quote");
    expect(flat).toContain("section-divider");
    expect(flat).toContain("section-divider-ornament");
  });

  it("allowlists loading attribute on img", () => {
    const schema = buildSanitizeSchema();
    const imgAttrs = schema.attributes?.img ?? [];
    expect(imgAttrs).toContain("loading");
  });

  it("allowlists class/className globally but NEVER style (CSS is not sanitized)", () => {
    const schema = buildSanitizeSchema();
    const wildcard = schema.attributes?.["*"] ?? [];
    expect(wildcard).toContain("class");
    expect(wildcard).toContain("className");
    // A global style allowlist would weaken the XSS boundary (overlay/exfiltration CSS).
    expect(wildcard).not.toContain("style");
  });

  it("keeps style scoped to pre/code for Shiki block-level theme colors", () => {
    const schema = buildSanitizeSchema();
    expect(schema.attributes?.pre ?? []).toContain("style");
    expect(schema.attributes?.code ?? []).toContain("style");
  });
});
