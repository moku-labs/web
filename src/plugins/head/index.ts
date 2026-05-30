/**
 * @file head — Standard Plugin skeleton.
 * @see README.md
 */
import { createPlugin } from "../../config";
import { i18nPlugin } from "../i18n";
import { routerPlugin } from "../router";
import { sitePlugin } from "../site";
import { createApi } from "./api";
import { headHelpers } from "./helpers";
import { createState } from "./state";

export const headPlugin = createPlugin("head", {
  depends: [sitePlugin, i18nPlugin, routerPlugin],
  helpers: headHelpers,
  createState,
  api: createApi
});

export {
  buildArticleHead,
  canonical,
  feedLink,
  hreflang,
  jsonLd,
  meta,
  og,
  twitter
} from "./primitives";
