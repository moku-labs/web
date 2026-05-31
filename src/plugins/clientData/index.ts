/**
 * @file clientData — Standard tier plugin (wiring-only).
 *
 * Build-emit half of the two-world data pattern. Writes a STABLE route-index +
 * per-route content-hashed JSON sidecars from the framework's own typed data so
 * the SPA consume-half can do JSON-driven navigation. Node-only, build-time.
 * Depends on router + content. NOT a framework default — added by
 * `createHybridApp`/`createSpaApp` via `createApp({ plugins: [clientDataPlugin] })`.
 * @see README.md
 */
import { createPlugin } from "../../config";
import { contentPlugin } from "../content";
import { routerPlugin } from "../router";
import { clientDataApi } from "./api";
import { defaultClientDataConfig } from "./config";
import { createClientDataState } from "./state";
import { validateClientDataConfig } from "./validate";

/**
 * ClientData plugin — emits the client route-index + per-route JSON sidecars via
 * an awaited `emit()`. Build ordering is the call-site contract
 * (`await app.build.run(); await app.clientData.emit();`), so there is no `build`
 * depends edge. No `onStart`/`onStop` (one-shot, holds no resource).
 *
 * @example
 * ```ts
 * const app = createHybridApp({ pluginConfigs: { content: { contentDir: "./content" } } });
 * await app.start();
 * await app.build.run();
 * await app.clientData.emit();
 * ```
 */
export const clientDataPlugin = createPlugin("clientData", {
  depends: [routerPlugin, contentPlugin],
  config: defaultClientDataConfig,
  createState: createClientDataState,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring
  onInit: ctx => validateClientDataConfig(ctx.config),
  api: clientDataApi
});
