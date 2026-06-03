/**
 * @file cli — Complex plugin (wiring harness only). Developer CLI:
 * build · serve · preview · deploy, with the boxed Panel renderer.
 * Depends: build, deploy. Listens: build:phase, build:complete, deploy:complete.
 * @see README.md
 */
import { createPlugin } from "../../config";
import { buildPlugin } from "../build";
import { deployPlugin } from "../deploy";
import { createApi, validateConfig } from "./api";
import { defaultConfig } from "./defaults";
import { createState } from "./state";

/**
 * cli plugin — the node-only developer CLI for `@moku-labs/web`. Mounts exactly four
 * methods at `app.cli` (`build`/`serve`/`preview`/`deploy`), each rendering through
 * the boxed Panel UI. Live build/deploy progress rides on hooks over the `build` and
 * `deploy` plugins' events; there is no argv parser and no `run()` dispatcher — the
 * consumer drives it from one thin script per command.
 *
 * @example Compose the CLI in a consumer app (node-only)
 * ```ts
 * import { buildPlugin, cliPlugin, createApp, deployPlugin } from "@moku-labs/web";
 *
 * const app = createApp({
 *   plugins: [buildPlugin, deployPlugin, cliPlugin],
 *   pluginConfigs: { cli: { outDir: "dist", port: 4173, watchDirs: ["content", "src"] } }
 * });
 * await app.start();
 * await app.cli.build();
 * ```
 */
export const cliPlugin = createPlugin("cli", {
  config: defaultConfig,
  depends: [buildPlugin, deployPlugin],
  createState,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring; validation in api.ts
  onInit: ctx => validateConfig(ctx.config),
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring; render-only handlers delegate to state.render
  hooks: ctx => ({
    // eslint-disable-next-line jsdoc/require-jsdoc -- render-only: live per-phase row
    "build:phase": p => ctx.state.render.phase(p),
    // eslint-disable-next-line jsdoc/require-jsdoc -- render-only: BUILD summary block
    "build:complete": p => ctx.state.render.built(p),
    // eslint-disable-next-line jsdoc/require-jsdoc -- render-only: deploy result panel
    "deploy:complete": p => ctx.state.render.deployed(p)
  }),
  api: createApi
});

export type * from "./types";
