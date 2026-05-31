/**
 * @file clientData plugin — config validation (runs at onInit).
 */
import type { ClientDataConfig } from "./types";

/**
 * Validates the resolved clientData config. The payload discriminant must be a
 * known mode; the full emit pipeline is wired in build wave 3.
 *
 * @param config - The resolved plugin configuration.
 * @throws {Error} If `payload` is neither `"fragment"` nor `"data"`.
 * @example
 * ```ts
 * validateClientDataConfig({ outputDir: "_data", payload: "fragment" });
 * ```
 */
export function validateClientDataConfig(config: ClientDataConfig): void {
  if (config.payload !== "fragment" && config.payload !== "data") {
    throw new Error(
      `clientData: invalid payload "${String(config.payload)}" (expected "fragment" or "data")`
    );
  }
}
