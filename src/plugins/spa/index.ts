/**
 * @file spa — Complex Plugin (WIRING ONLY, ≤30 lines). All logic lives in the
 * domain files (kernel/router/head/progress/components/lifecycle); index wires.
 *
 * Depends: router, head.
 * Emits: spa:navigate, spa:navigated, spa:component-mount, spa:component-unmount.
 * @see README.md
 */
import { createPlugin } from "../../config";
import { headPlugin } from "../head";
import { routerPlugin } from "../router";
import { createApi } from "./api";
import { spaEvents } from "./events";
import { initSpa } from "./kernel";
import { captureTeardown, disposeSpa } from "./lifecycle";
import { createState, defaultSpaConfig } from "./state";

/**
 * SPA plugin — progressive client-side navigation layered over the static site:
 * swaps a page region on navigation, with an optional progress bar and View
 * Transitions. Register interactive islands with {@link createComponent}. Depends
 * on router and head; emits `spa:navigate`, `spa:navigated`, `spa:component-mount`,
 * and `spa:component-unmount`.
 *
 * @example Enable view transitions and a custom swap region
 * ```ts
 * const app = createApp({
 *   pluginConfigs: {
 *     spa: {
 *       swapSelector: "main > section",
 *       viewTransitions: true,
 *       progressBar: true
 *     }
 *   }
 * });
 * ```
 */
export const spaPlugin = createPlugin("spa", {
  depends: [routerPlugin, headPlugin],
  config: defaultSpaConfig,
  createState,
  events: spaEvents,
  onInit: initSpa,
  api: createApi,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring; boot lives in kernel.boot()
  onStart(ctx) {
    captureTeardown(ctx);
    ctx.state.kernel?.boot();
  },
  onStop: disposeSpa // disposeSpa runs the captured kernel.dispose() in try/catch/finally
});

export { createComponent } from "./components";
