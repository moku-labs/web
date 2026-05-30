/**
 * @file spa — Complex Plugin skeleton (WIRING ONLY, ≤30 lines).
 * @see README.md
 */
import { createPlugin } from "../../config";
import { headPlugin } from "../head";
import { routerPlugin } from "../router";
import { createApi } from "./api";
import { spaEvents } from "./events";
import { initSpa, kernelRef } from "./kernel";
import { createState, defaultSpaConfig } from "./state";

export const spaPlugin = createPlugin("spa", {
  depends: [routerPlugin, headPlugin],
  config: defaultSpaConfig,
  createState,
  events: spaEvents,
  onInit: initSpa,
  api: createApi,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring; resource teardown
  onStop() {
    kernelRef.current?.dispose();
  }
});

export { createComponent } from "./components";
