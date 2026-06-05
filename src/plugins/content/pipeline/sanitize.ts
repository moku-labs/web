/**
 * @file content pipeline — sanitize schema.
 *
 * The XSS boundary. Provides the extended rehype-sanitize schema that allowlists
 * only the classes/attributes the framework transforms need (pull-quote,
 * section-divider, loading="lazy"). Consumed by pipeline/markdown.ts, which runs
 * rehype-sanitize LAST whenever config.trustedContent is false.
 */
import { defaultSchema } from "hast-util-sanitize";
import type { Options } from "rehype-sanitize";

/**
 * Build the extended rehype-sanitize schema used as the final pipeline step.
 * Clones the library default and additively allowlists the markup our custom
 * transforms emit: `class` values (`pull-quote`, `section-divider`,
 * `section-divider-ornament`) on `aside`/`div`/`span`, and the `loading`
 * attribute on `img`. `class`/`className`/`style` are allowlisted globally (`*`,
 * i.e. on every element) — not just on `pre`/`code`/`span` — so Shiki's inline
 * token colors survive the sanitize pass.
 *
 * @returns The extended, security-hardened sanitize schema.
 * @example
 * ```ts
 * const schema = buildSanitizeSchema();
 * ```
 */
export function buildSanitizeSchema(): Options {
  const base = defaultSchema;
  const baseAttributes = base.attributes ?? {};
  const directiveClasses = ["pull-quote", "section-divider", "section-divider-ornament"];

  return {
    ...base,
    tagNames: [...(base.tagNames ?? []), "aside", "div", "span", "pre", "code"],
    attributes: {
      ...baseAttributes,
      "*": [...(baseAttributes["*"] ?? []), "className", "class", "style"],
      aside: [...(baseAttributes.aside ?? []), ["className", ...directiveClasses], "class"],
      div: [...(baseAttributes.div ?? []), ["className", ...directiveClasses], "class"],
      span: [...(baseAttributes.span ?? []), ["className", ...directiveClasses], "class"],
      pre: [...(baseAttributes.pre ?? []), "className", "class", "style"],
      code: [...(baseAttributes.code ?? []), "className", "class", "style"],
      img: [...(baseAttributes.img ?? []), "loading", "src", "alt"]
    }
  };
}
