/**
 * @file content pipeline — framework default remark/rehype plugin arrays skeleton.
 *
 * Framework default plugin arrays live HERE (and are wired by markdown.ts),
 * NEVER as a config-array default — a config array would be wiped by shallow
 * merge. Consumers extend via additive extraRemarkPlugins / extraRehypePlugins.
 */
import type { Pluggable } from "unified";

/**
 * The hardcoded framework default remark (Markdown-AST) plugins, in order
 * (parse, frontmatter, gfm, directive, remark-rehype).
 *
 * @example
 * ```ts
 * const remark = defaultRemarkPlugins();
 * ```
 */
export function defaultRemarkPlugins(): readonly Pluggable[] {
  throw new Error("not implemented");
}

/**
 * The hardcoded framework default rehype (HTML-AST) plugins, in order
 * (rehype-raw, custom transforms; Shiki + sanitize are appended by markdown.ts).
 *
 * @example
 * ```ts
 * const rehype = defaultRehypePlugins();
 * ```
 */
export function defaultRehypePlugins(): readonly Pluggable[] {
  throw new Error("not implemented");
}
