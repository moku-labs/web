/**
 * @file content pipeline — sanitize schema skeleton.
 *
 * The XSS boundary. Provides the extended rehype-sanitize schema that allowlists
 * only the classes/attributes the framework transforms need (pull-quote,
 * section-divider, loading="lazy"). Consumed by pipeline/markdown.ts, which runs
 * rehype-sanitize LAST whenever config.trustedContent is false.
 */
import type { Options } from "rehype-sanitize";

/**
 * Build the extended rehype-sanitize schema used as the final pipeline step.
 *
 * @example
 * ```ts
 * const schema = buildSanitizeSchema();
 * ```
 */
export function buildSanitizeSchema(): Options {
  throw new Error("not implemented");
}
