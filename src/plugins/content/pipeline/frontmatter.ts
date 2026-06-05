/**
 * @file content pipeline — frontmatter parsing.
 */
import matter from "gray-matter";
import type { FileSystemContentOptions, Frontmatter } from "../types";

/** Required frontmatter fields; absence throws a `[web] content` error. */
const REQUIRED_FIELDS = ["title", "date", "description", "tags", "language"] as const;

/**
 * Parse YAML frontmatter from raw file content via gray-matter, coercing `Date`
 * values to ISO `YYYY-MM-DD` strings (js-yaml auto-parses bare dates, which
 * would otherwise timezone-shift), validating required fields, and applying
 * defaults (`draft=false`, `author=config.defaultAuthor`). The parsed data is
 * cloned so gray-matter's internal cache is never mutated between calls.
 *
 * @param raw - Raw article file content (frontmatter + body).
 * @param config - Resolved plugin configuration (supplies `defaultAuthor`).
 * @returns The validated frontmatter and the body content (delimiters stripped).
 * @throws {Error} If any required field is missing or null.
 * @example
 * ```ts
 * const { frontmatter, body } = parseFrontmatter(raw, config);
 * ```
 */
export function parseFrontmatter(
  raw: string,
  config: FileSystemContentOptions
): { frontmatter: Frontmatter; body: string } {
  const parsed = matter(raw);
  // Clone to avoid mutating gray-matter's per-input cache (shared references).
  const data: Record<string, unknown> = { ...parsed.data };

  if (data.date instanceof Date) {
    const isoDay = data.date.toISOString().split("T")[0];
    if (isoDay === undefined) {
      throw new Error("[web] content frontmatter: failed to derive ISO date string.");
    }
    data.date = isoDay;
  }

  for (const field of REQUIRED_FIELDS) {
    if (data[field] === undefined || data[field] === null) {
      throw new Error(
        `[web] content frontmatter is missing required field "${field}".\n` +
          "  Every article needs title, date, description, tags, and language."
      );
    }
  }

  if (data.draft === undefined) {
    data.draft = false;
  }
  if ((data.author === undefined || data.author === null) && config.defaultAuthor !== undefined) {
    data.author = config.defaultAuthor;
  }

  return { frontmatter: data as Frontmatter, body: parsed.content };
}
