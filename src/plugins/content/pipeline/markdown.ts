/**
 * @file content pipeline — lazy unified processor builder.
 */
import rehypeShiki from "@shikijs/rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import type { Processor } from "unified";
import { unified } from "unified";
import type { ContentProviderState, FileSystemContentOptions } from "../types";
import { defaultRehypePlugins, defaultRemarkPlugins } from "./plugins";
import { buildSanitizeSchema } from "./sanitize";

/**
 * Lazily build (and cache on `state.processor`) the unified processor: the
 * framework default remark/rehype arrays are HARDCODED here (via
 * {@link defaultRemarkPlugins} / {@link defaultRehypePlugins}), the consumer's
 * `extraRemarkPlugins` / `extraRehypePlugins` are CONCATENATED after them (never
 * replacing the defaults), Shiki highlighting runs, and `rehype-sanitize` runs
 * LAST — the XSS boundary — whenever `config.trustedContent` is `false`. When
 * `trustedContent` is `true` the sanitize step is skipped (author-controlled
 * content only). The processor is reused across every render in this app; a
 * second app gets its own because state is per-app.
 *
 * @param state - Plugin state holding the processor singleton slot.
 * @param config - Resolved plugin configuration (trustedContent, shikiTheme, extras).
 * @returns The shared unified processor (created on first call, cached after).
 * @example
 * ```ts
 * const processor = ensureProcessor(state, config);
 * const html = String(await processor.process(markdown));
 * ```
 */
export function ensureProcessor(
  state: ContentProviderState,
  config: FileSystemContentOptions
): Processor {
  if (state.processor !== null) {
    return state.processor;
  }

  const processor = unified();
  for (const plugin of defaultRemarkPlugins()) {
    applyPluggable(processor, plugin);
  }
  for (const plugin of config.extraRemarkPlugins ?? []) {
    applyPluggable(processor, plugin);
  }
  for (const plugin of defaultRehypePlugins()) {
    applyPluggable(processor, plugin);
  }
  for (const plugin of config.extraRehypePlugins ?? []) {
    applyPluggable(processor, plugin);
  }
  processor.use(rehypeShiki, { theme: config.shikiTheme ?? "github-dark" });
  if (!config.trustedContent) {
    processor.use(rehypeSanitize, buildSanitizeSchema());
  }
  processor.use(rehypeStringify, { allowDangerousHtml: true });

  state.processor = processor as Processor;
  return state.processor;
}

/**
 * Apply one `Pluggable` to the processor, normalising the `[plugin, options]`
 * tuple form so a single `.use()` call site handles both shapes.
 *
 * @param processor - The unified processor under construction.
 * @param plugin - A plugin or a `[plugin, options]` tuple.
 * @example
 * ```ts
 * applyPluggable(processor, [remarkRehype, { allowDangerousHtml: true }]);
 * ```
 */
function applyPluggable(processor: ReturnType<typeof unified>, plugin: unknown): void {
  if (Array.isArray(plugin)) {
    const [fn, options] = plugin as [never, never];
    processor.use(fn, options);
    return;
  }
  processor.use(plugin as never);
}
