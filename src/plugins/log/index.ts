/**
 * @file log — Core Plugin (Standard tier): in-memory trace + expect() DSL.
 * @see README.md
 */
import { createCorePlugin } from "@moku-labs/core";
import { createLogApi } from "./api";
import { installDefaultSinks } from "./sinks";
import { createLogState } from "./state";
import type { LogConfig } from "./types";

/** Default config; overridden via the 4-level pluginConfigs.log merge. */
const defaultLogConfig: LogConfig = { mode: "production" };

/**
 * Core logging plugin — always-on in-memory trace + `expect()` event-trace DSL.
 * API injected as `ctx.log` on every regular plugin and surfaced as `app.log`.
 * No depends / events / hooks (core plugin per spec/03 §5).
 *
 * @see README.md
 */
export const logPlugin = createCorePlugin("log", {
  config: defaultLogConfig,
  createState: createLogState,
  api: createLogApi,
  onInit: installDefaultSinks
});
