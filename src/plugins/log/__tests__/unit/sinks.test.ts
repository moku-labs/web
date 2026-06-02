import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogApi } from "../../api";
import { consoleSink, installDefaultSinks } from "../../sinks";
import { createLogState } from "../../state";
import type { LogConfig } from "../../types";

/**
 * Install default sinks for a mode then log one entry.
 *
 * @param mode - The log mode to exercise.
 */
function exercise(mode: LogConfig["mode"]): void {
  const state = createLogState({ config: { mode } });
  installDefaultSinks({ config: { mode }, state });
  createLogApi({ config: { mode }, state }).info("m:event");
}

describe("log console sink routing", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("error -> console.error, warn -> console.warn, debug/info -> console.log", () => {
    const sink = consoleSink();
    sink.write({ level: "error", event: "e", ts: 0 });
    sink.write({ level: "warn", event: "w", ts: 0 });
    sink.write({ level: "debug", event: "d", ts: 0 });
    sink.write({ level: "info", event: "i", ts: 0 });

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledTimes(2);
  });

  it("each call serializes the entry (entry data is forwarded)", () => {
    const sink = consoleSink();
    sink.write({ level: "info", event: "content:ready", data: { count: 12 }, ts: 0 });
    const call = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const serialized = JSON.stringify(call);
    expect(serialized).toContain("content:ready");
    expect(serialized).toContain("12");
  });

  it("test/silent install no console sink; dev/production install a console sink", () => {
    for (const mode of ["test", "silent"] as const) {
      const state = createLogState({ config: { mode } });
      installDefaultSinks({ config: { mode }, state });
      expect(state.sinks).toHaveLength(0);
    }
    for (const mode of ["dev", "production"] as const) {
      const state = createLogState({ config: { mode } });
      installDefaultSinks({ config: { mode }, state });
      expect(state.sinks).toHaveLength(1);
    }
  });

  it("dev/production logging triggers console.*; test/silent does not", () => {
    exercise("test");
    exercise("silent");
    expect(console.log).not.toHaveBeenCalled();
    exercise("dev");
    exercise("production");
    expect(console.log).toHaveBeenCalledTimes(2);
  });

  it("consoleSink(minLevel) drops entries below the threshold", () => {
    const sink = consoleSink("info");
    sink.write({ level: "debug", event: "d", ts: 0 }); // below info -> dropped
    sink.write({ level: "info", event: "i", ts: 0 });
    sink.write({ level: "warn", event: "w", ts: 0 });
    sink.write({ level: "error", event: "e", ts: 0 });
    expect(console.log).toHaveBeenCalledTimes(1); // info only (debug dropped)
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("production suppresses debug (info+ only); dev prints debug", () => {
    const prod = createLogState({ config: { mode: "production" } });
    installDefaultSinks({ config: { mode: "production" }, state: prod });
    createLogApi({ config: { mode: "production" }, state: prod }).debug("build:bundle");
    expect(console.log).not.toHaveBeenCalled(); // debug suppressed in production

    const dev = createLogState({ config: { mode: "dev" } });
    installDefaultSinks({ config: { mode: "dev" }, state: dev });
    createLogApi({ config: { mode: "dev" }, state: dev }).debug("build:bundle");
    expect(console.log).toHaveBeenCalledTimes(1); // debug printed in dev
  });

  it("trace records entries in all four modes", () => {
    for (const mode of ["test", "silent", "dev", "production"] as const) {
      const state = createLogState({ config: { mode } });
      installDefaultSinks({ config: { mode }, state });
      const api = createLogApi({ config: { mode }, state });
      api.info("recorded");
      expect(api.trace()).toHaveLength(1);
    }
  });
});
