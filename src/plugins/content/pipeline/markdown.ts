/**
 * @file content pipeline — lazy unified processor builder skeleton.
 */
import type { Processor } from "unified";
import type { Config, State } from "../types";

/**
 * Lazily build (and cache on state.processor) the unified processor: framework
 * default remark/rehype arrays HARDCODED here, with extraRemark/extraRehype
 * plugins concatenated, Shiki highlighting, and rehype-sanitize LAST when
 * config.trustedContent is false.
 *
 * @param _state - Plugin state holding the processor singleton slot.
 * @param _config - Resolved plugin configuration (trustedContent, shikiTheme, extras).
 * @example
 * ```ts
 * const processor = ensureProcessor(state, config);
 * ```
 */
export function ensureProcessor(_state: State, _config: Config): Processor {
  throw new Error("not implemented");
}
