/**
 * @file data — Standard tier plugin (wiring-only).
 *
 * Build-emit half of the two-world data pattern. Writes a STABLE route-index +
 * per-route content-hashed JSON sidecars from the framework's own typed data so
 * the SPA consume-half can do JSON-driven navigation. Node-only, build-time.
 * Depends on router + content. NOT a framework default — the consumer composes it
 * for a Node build via `createApp({ plugins: [dataPlugin, contentPlugin] })`.
 * @see README.md
 */
import { createPlugin } from "../../config";
import { contentPlugin } from "../content";
import { routerPlugin } from "../router";
import { dataApi } from "./api";
import { defaultDataConfig } from "./config";
import { createDataState } from "./state";
import { validateDataConfig } from "./validate";

/**
 * Data plugin — emits the client route-index + per-route JSON sidecars via
 * an awaited `emit()`. Build ordering is the call-site contract
 * (`await app.build.run(); await app.data.emit();`), so there is no `build`
 * depends edge. No `onStart`/`onStop` (one-shot, holds no resource).
 *
 * @example
 * ```ts
 * const app = createApp({
 *   plugins: [dataPlugin, contentPlugin, buildPlugin],
 *   pluginConfigs: { content: { contentDir: "./content" } }
 * });
 * await app.start();
 * await app.build.run();
 * await app.data.emit();
 * ```
 */
export const dataPlugin = createPlugin("data", {
  depends: [routerPlugin, contentPlugin],
  config: defaultDataConfig,
  createState: createDataState,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring
  onInit: ctx => validateDataConfig(ctx.config),
  api: dataApi
});
