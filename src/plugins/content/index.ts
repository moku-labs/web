/**
 * @file content — Complex Plugin skeleton (wiring-only).
 *
 * Markdown pipeline: discover, parse frontmatter, render to sanitized HTML, and
 * expose a locale-keyed Article model. Depends on i18n. Emits `content:ready`
 * and `content:invalidated`.
 * @see README.md
 */
import { createPlugin } from "../../config";
import { i18nPlugin } from "../i18n";
import { contentApi } from "./api";
import { defaultContentConfig } from "./config";
import { contentEvents } from "./events";
import { createContentState } from "./state";
import { validateContentConfig } from "./validate";

/**
 * Content plugin — Markdown pipeline: discovers files, parses frontmatter, renders
 * to sanitized HTML (rehype-sanitize unless `trustedContent`), and exposes a
 * locale-keyed Article model. Depends on i18n; emits `content:ready` and
 * `content:invalidated`.
 *
 * @example Point at a content directory and pick a Shiki theme
 * ```ts
 * const app = createApp({
 *   pluginConfigs: {
 *     content: {
 *       contentDir: "./content",
 *       shikiTheme: "github-dark",
 *       defaultAuthor: "Ada Lovelace"
 *       // trustedContent: true // ONLY for fully author-controlled Markdown — disables sanitize
 *     }
 *   }
 * });
 * ```
 */
export const contentPlugin = createPlugin("content", {
  depends: [i18nPlugin],
  events: contentEvents,
  config: defaultContentConfig,
  createState: createContentState,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring
  onInit: ctx => validateContentConfig(ctx.config),
  api: contentApi
});
