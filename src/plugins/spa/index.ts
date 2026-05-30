/**
 * @file spa — Complex Plugin (WIRING ONLY, ≤30 lines). All logic lives in the
 * domain files (kernel/router/head/progress/components/lifecycle); index wires.
 */
import { createPlugin } from "../../config";
import { headPlugin } from "../head";
import { routerPlugin } from "../router";
import { createApi } from "./api";
import { spaEvents } from "./events";
import { initSpa, kernelRef } from "./kernel";
import { captureTeardown, disposeSpa } from "./lifecycle";
import { createState, defaultSpaConfig } from "./state";

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
    kernelRef.current?.boot();
  },
  onStop: disposeSpa // disposeSpa runs the captured kernel.dispose() in try/catch/finally
});

export { createComponent } from "./components";
