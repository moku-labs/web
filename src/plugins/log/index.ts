/**
 * Framework structured-logging + workflow-verification core plugin. Records
 * every entry in an always-on in-memory trace and fans out to mode-selected
 * sinks; exposes the `expect()` event-trace DSL. API injected as `ctx.log` on
 * every regular plugin context and surfaced as `app.log`. NO depends / events /
 * hooks (core plugin per spec/03 §5).
 *
 * @file log — Core Plugin skeleton (Standard tier).
 * @see README.md
 */
import { createCorePlugin } from "@moku-labs/core";
import { createLogApi } from "./api";
import { installDefaultSinks } from "./sinks";
import { createLogState } from "./state";
import type { LogConfig } from "./types";

/** Default config; overridden via the 4-level pluginConfigs.log merge. */
const defaultLogConfig: LogConfig = { mode: "production" };

export const logPlugin = createCorePlugin("log", {
  config: defaultLogConfig,
  createState: createLogState,
  api: createLogApi,
  onInit: installDefaultSinks
});
