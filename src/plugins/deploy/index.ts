/**
 * @file deploy — Standard Plugin skeleton (wiring harness only). Deploys the
 * built dist/ to Cloudflare Pages via the injectable wrangler subprocess.
 * @see README.md
 */

import { createPlugin } from "../../config";
import { sitePlugin } from "../site";
import { createApi, validateConfig } from "./api";
import { defaultConfig } from "./defaults";
import { deployEvents } from "./events";
import { createState } from "./state";

export const deployPlugin = createPlugin("deploy", {
  config: defaultConfig,
  depends: [sitePlugin],
  createState,
  events: deployEvents,
  onInit: validateConfig,
  api: createApi
});

export type * from "./types";
