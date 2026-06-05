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

/** Shiki theme used when the consumer does not override `config.shikiTheme`. */
const DEFAULT_SHIKI_THEME = "github-dark";

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

/**
 * Register the markdown (remark) stage: the framework defaults first, then the
 * consumer's `extraRemarkPlugins` concatenated after them (extending, never
 * replacing, the defaults).
 *
 * @param processor - The unified processor under construction (mutated in place).
 * @param config - Resolved plugin configuration (provides `extraRemarkPlugins`).
 * @example
 * ```ts
 * applyRemarkPlugins(processor, config);
 * ```
 */
function applyRemarkPlugins(
  processor: ReturnType<typeof unified>,
  config: FileSystemContentOptions
): void {
  for (const plugin of defaultRemarkPlugins()) {
    applyPluggable(processor, plugin);
  }
  for (const plugin of config.extraRemarkPlugins ?? []) {
    applyPluggable(processor, plugin);
  }
}

/**
 * Register the HTML (rehype) stage: the framework defaults first, then the
 * consumer's `extraRehypePlugins` concatenated after them (extending, never
 * replacing, the defaults).
 *
 * @param processor - The unified processor under construction (mutated in place).
 * @param config - Resolved plugin configuration (provides `extraRehypePlugins`).
 * @example
 * ```ts
 * applyRehypePlugins(processor, config);
 * ```
 */
function applyRehypePlugins(
  processor: ReturnType<typeof unified>,
  config: FileSystemContentOptions
): void {
  for (const plugin of defaultRehypePlugins()) {
    applyPluggable(processor, plugin);
  }
  for (const plugin of config.extraRehypePlugins ?? []) {
    applyPluggable(processor, plugin);
  }
}

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
  // Reuse the cached processor — it is built once and shared per app.
  if (state.processor !== null) {
    return state.processor;
  }

  // Register the markdown then HTML transform stages (defaults + consumer extras).
  const processor = unified();
  applyRemarkPlugins(processor, config);
  applyRehypePlugins(processor, config);

  // Add syntax highlighting before any output stage runs.
  processor.use(rehypeShiki, { theme: config.shikiTheme ?? DEFAULT_SHIKI_THEME });

  // Sanitize untrusted content LAST — the XSS boundary; trusted content opts out.
  const shouldSanitize = !config.trustedContent;
  if (shouldSanitize) {
    processor.use(rehypeSanitize, buildSanitizeSchema());
  }

  // Serialize to HTML, then cache the assembled processor for reuse.
  processor.use(rehypeStringify, { allowDangerousHtml: true });
  state.processor = processor as Processor;
  return state.processor;
}
