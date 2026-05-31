/**
 * @file data — Standard tier plugin (wiring-only). The isomorphic BRIDGE for the
 * two-world data pattern.
 *
 * Owns the build↔runtime data contract on both sides: `emit()` writes a STABLE
 * route-index + per-route content-hashed JSON sidecars on Node (build); `load()`/
 * `manifest()` fetch and parse them in the browser for `spa`'s JSON-driven
 * navigation. NOT a framework default — the consumer composes it where needed
 * (Node build AND/OR browser app).
 *
 * **No hard `depends`** — keeping it browser-composable. `emit()` (Node) lazily
 * `require`s `router` + `content` at call time (present in a Node build); the
 * browser read side needs neither. Build ordering stays a call-site contract
 * (`await app.build.run(); await app.data.emit();`). No `onStart`/`onStop`.
 * @see README.md
 */
import { createPlugin } from "../../config";
import { dataApi } from "./api";
import { defaultDataConfig } from "./config";
import { createDataState } from "./state";
import { validateDataConfig } from "./validate";

/**
 * Data plugin — the isomorphic bridge. Mounts `emit()` (Node write) +
 * `manifest()`/`load()` (browser read) at `app.data`.
 *
 * @example
 * ```ts
 * // Node build:
 * const app = createApp({
 *   plugins: [dataPlugin, contentPlugin, buildPlugin],
 *   pluginConfigs: { content: { contentDir: "./content" } }
 * });
 * await app.start();
 * await app.build.run();
 * await app.data.emit();
 *
 * // Browser app: compose `dataPlugin` too; spa calls app.data.load() on nav.
 * ```
 */
export const dataPlugin = createPlugin("data", {
  config: defaultDataConfig,
  createState: createDataState,
  // eslint-disable-next-line jsdoc/require-jsdoc -- thin wiring
  onInit: ctx => validateDataConfig(ctx.config),
  api: dataApi
});
