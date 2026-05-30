/**
 * @file Framework configuration — Config + Events types, core plugin registration.
 * @see README.md
 */
import { createCoreConfig } from "@moku-labs/core";
import { dotenv, envPlugin, processEnv } from "./plugins/env";
import { logPlugin } from "./plugins/log";

/**
 * Global framework configuration. Minimal by design — per-plugin config is
 * resolved via `pluginConfigs`, not merged here.
 */
export type Config = {
  /** Runtime mode. Drives log sink defaults, content draft filtering, build minify. */
  mode: "production" | "development";
};

/**
 * Framework event contract. Empty base — each plugin declares its own events
 * via the `events` register callback (spec/14 §2).
 */
// biome-ignore lint/complexity/noBannedTypes: framework declares no global events; plugins own theirs.
export type Events = {};

const defaultConfig: Config = { mode: "production" };

export const coreConfig = createCoreConfig<Config, Events, [typeof logPlugin, typeof envPlugin]>(
  "web",
  {
    config: defaultConfig,
    plugins: [logPlugin, envPlugin],
    pluginConfigs: {
      // Core-plugin defaults (levels 1–2 of the 4-level core cascade, spec/03 §5).
      log: { mode: "production" },
      // env: framework supplies the working provider default (.env.local wins over process.env).
      env: { providers: [dotenv(), processEnv()] }
    }
  }
);

export const { createPlugin, createCore } = coreConfig;
