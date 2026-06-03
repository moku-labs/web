/**
 * @file cli plugin — coded-error helper. Mirrors the deploy plugin's `deployError`
 * so every thrown value carries a stable taxonomy `code` property.
 */
import type { CliErrorCode } from "./types";

/** Error prefix for cli config/validation/runtime failures (spec/11 Part-3). */
export const ERROR_PREFIX = "[web] cli";

/**
 * Construct a cli `Error` carrying a taxonomy `code` property. Centralizes the
 * `Object.assign(new Error(message), { code })` pattern so the `code` is always
 * preserved on the thrown value (the message is expected to already be prefixed).
 *
 * @param code - The cli error `code` from the taxonomy.
 * @param message - The actionable error message.
 * @returns An `Error` whose `code` property is set.
 * @example
 * throw cliError("ERR_CLI_CONFIG", "[web] cli: port must be 1–65535.");
 */
export function cliError(code: CliErrorCode, message: string): Error & { code: CliErrorCode } {
  return Object.assign(new Error(message), { code });
}
