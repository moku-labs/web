import { describe, expect, it } from "vitest";
import { validateConfig } from "../../api";
import type { Config } from "../../types";
import { makeConfig } from "../helpers";

/** Assert that validating the given config throws an ERR_CLI_CONFIG error. */
function expectConfigError(config: Config): void {
  expect(() => validateConfig(config)).toThrowError(
    expect.objectContaining({ code: "ERR_CLI_CONFIG" })
  );
}

describe("cli/validateConfig", () => {
  it("accepts the default config", () => {
    expect(() => validateConfig(makeConfig())).not.toThrow();
  });

  it("rejects a non-integer port", () => {
    expectConfigError(makeConfig({ port: 4173.5 }));
  });

  it("rejects a port below 1", () => {
    expectConfigError(makeConfig({ port: 0 }));
  });

  it("rejects a port above 65535", () => {
    expectConfigError(makeConfig({ port: 70_000 }));
  });

  it("rejects an empty outDir", () => {
    expectConfigError(makeConfig({ outDir: "" }));
  });

  it("rejects a non-string outDir", () => {
    expectConfigError(makeConfig({ outDir: 123 as unknown as string }));
  });

  it("rejects an empty notFoundFile", () => {
    expectConfigError(makeConfig({ notFoundFile: "" }));
  });

  it("rejects an empty watchDirs array", () => {
    expectConfigError(makeConfig({ watchDirs: [] }));
  });

  it("rejects a non-array watchDirs", () => {
    expectConfigError(makeConfig({ watchDirs: "content" as unknown as string[] }));
  });

  it("rejects watchDirs containing an empty string", () => {
    expectConfigError(makeConfig({ watchDirs: ["content", ""] }));
  });

  it("rejects a negative debounceMs", () => {
    expectConfigError(makeConfig({ debounceMs: -1 }));
  });

  it("rejects a non-number debounceMs", () => {
    expectConfigError(makeConfig({ debounceMs: "150" as unknown as number }));
  });

  it("accepts debounceMs of 0 (no debounce)", () => {
    expect(() => validateConfig(makeConfig({ debounceMs: 0 }))).not.toThrow();
  });

  it("throws the [web] cli: prefixed message format", () => {
    let message = "";
    try {
      validateConfig(makeConfig({ port: -1 }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("[web] cli:");
  });
});
