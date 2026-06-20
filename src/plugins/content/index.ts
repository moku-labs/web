/**
 * @file content — Complex Plugin skeleton (wiring-only).
 *
 * Markdown pipeline: discover, parse frontmatter, render to sanitized HTML, and
 * expose a locale-keyed Article model. i18n is OPTIONAL (single default-locale
 * fallback when absent). Emits `content:ready` and `content:invalidated`.
 * @see README.md
 */
import { createPlugin } from "../../config";
import { contentApi } from "./api";
import { defaultContentConfig } from "./config";
import { contentEvents } from "./events";
import { createContentState } from "./state";
import { validateContentConfig } from "./validate";

/**
 * Content plugin (shell) — provider-driven locale-keyed Article model. Orchestration
 * (locale fallback, draft filtering, sort, caching, events) lives here; source I/O +
 * the Markdown pipeline live in a {@link ContentProvider} you compose (like `env`
 * providers). The shell imports zero node code, so `contentPlugin` is browser-safe.
 * i18n is OPTIONAL (single default-locale fallback when absent); emits `content:ready`
 * and `content:invalidated`.
 *
 * @example Compose the node filesystem provider with a content dir + Shiki theme
 * ```ts
 * import { contentPlugin, fileSystemContent } from "@moku-labs/web";
 * const app = createApp({
 *   plugins: [contentPlugin],
 *   pluginConfigs: {
 *     content: {
 *       providers: [fileSystemContent({ contentDir: "./content", shikiTheme: "github-dark", defaultAuthor: "Ada" })]
 *     }
 *   }
 * });
 * ```
 */
export const contentPlugin = createPlugin("content", {
  events: contentEvents,
  config: defaultContentConfig,
  createState: createContentState,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring
  onInit: ctx => validateContentConfig(ctx.config),
  api: contentApi
});
