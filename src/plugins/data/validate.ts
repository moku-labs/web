/**
 * @file data plugin — config validation (runs at onInit).
 */
import type { DataConfig } from "./types";

/**
 * Validates the resolved data config. The payload discriminant must be a
 * known mode; the full emit pipeline is wired in build wave 3.
 *
 * @param config - The resolved plugin configuration.
 * @throws {Error} If `payload` is neither `"fragment"` nor `"data"`.
 * @example
 * ```ts
 * validateDataConfig({ outputDir: "_data", payload: "fragment" });
 * ```
 */
export function validateDataConfig(config: DataConfig): void {
  if (config.payload !== "fragment" && config.payload !== "data") {
    throw new Error(
      `data: invalid payload "${String(config.payload)}" (expected "fragment" or "data")`
    );
  }
}
