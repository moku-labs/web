/**
 * @file data — Standard tier plugin (wiring-only). The AGNOSTIC data provider for
 * the SSG→DATA→SPA pattern.
 *
 * Owns ONE contract — `page path → persisted JSON file` — and nothing about what
 * the data is: `write(entries)` persists per-page JSON on Node (build supplies the
 * entries it already expanded); `at(path)` fetches + caches it in the browser as
 * `unknown`, which the route uses directly as `ctx.data` in `render`. NOT a framework
 * default — the consumer composes it where needed (Node build AND/OR browser app).
 *
 * **No hard `depends`** — fully browser-composable; the `node:fs` writer is behind
 * a lazy `import()` inside `write()`. Build ordering is a call-site contract: build
 * writes data during its pages phase (after its Phase-0 clean), via `app.data.write`.
 * `onStart` schedules the optional `preload: "all"` bundle fetch (browser, idle);
 * `onStop` cancels it.
 * @see README.md
 */
import { createPlugin } from "../../config";
import { dataApi } from "./api";
import { defaultDataConfig } from "./config";
import { startPreload, stopPreload } from "./preload";
import { createDataState } from "./state";
import { validateDataConfig } from "./validate";

/**
 * Data plugin — the agnostic data provider. Mounts `write(entries)` (Node persist),
 * `at(path)` (browser read), and the pure `urlFor`/`fileFor` convention at `app.data`.
 *
 * @example
 * ```ts
 * // Node build: `build` calls app.data.write(...) during its pages phase when
 * // router.mode() !== "ssg". Compose the plugin + set the global render mode:
 * import * as routes from "./routes";
 * const app = createApp({
 *   plugins: [dataPlugin, contentPlugin, buildPlugin],
 *   config: { mode: "hybrid" },
 *   pluginConfigs: { content: { providers: [fileSystemContent({ contentDir: "./content" })] }, router: { routes } }
 * });
 * await app.build.run();   // writes HTML + per-page data sidecars (routes compiled at init)
 *
 * // Browser app: compose `dataPlugin` too; spa fetches via app.data.at(path) on nav.
 * ```
 */
export const dataPlugin = createPlugin("data", {
  config: defaultDataConfig,
  createState: createDataState,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring
  onInit: ctx => validateDataConfig(ctx.config),
  api: dataApi,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring; logic lives in ./preload
  onStart: ctx => startPreload(ctx),
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring; logic lives in ./preload
  onStop: ctx => stopPreload(ctx)
});
