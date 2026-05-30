/**
 * @file content pipeline — frontmatter parsing skeleton.
 */
import type { Config, Frontmatter } from "../types";

/**
 * Parse YAML frontmatter from raw file content via gray-matter, coercing Date
 * values to ISO strings, validating required fields, and applying defaults
 * (draft=false, author=config.defaultAuthor). Returns the frontmatter and body.
 *
 * @param _raw - Raw article file content (frontmatter + body).
 * @param _config - Resolved plugin configuration (defaultAuthor).
 * @example
 * ```ts
 * const { frontmatter, body } = parseFrontmatter(raw, config);
 * ```
 */
export function parseFrontmatter(
  _raw: string,
  _config: Config
): { frontmatter: Frontmatter; body: string } {
  throw new Error("not implemented");
}
