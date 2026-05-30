import { describe, expect, it } from "vitest";
import { createLogApi } from "../../api";
import { createLogState } from "../../state";
import type { LogEntry, LogState } from "../../types";

/**
 * Build a fresh api + state pair for a unit test.
 *
 * @returns The state and api bound to it.
 */
function setup(): { state: LogState; api: ReturnType<typeof createLogApi> } {
  const state = createLogState({ config: { mode: "test" } });
  const api = createLogApi({ config: { mode: "test" }, state });
  return { state, api };
}

describe("log api", () => {
  it("info/debug/warn/error append one entry with correct level, event, data, numeric ts", () => {
    const { state, api } = setup();
    const before = Date.now();
    api.info("a:info", { x: 1 });
    api.debug("a:debug", { y: 2 });
    api.warn("a:warn");
    api.error("a:error", { z: 3 });
    const after = Date.now();

    expect(state.entries).toHaveLength(4);
    const [info, debug, warn, error] = state.entries as LogEntry[];
    expect(info).toMatchObject({ level: "info", event: "a:info", data: { x: 1 } });
    expect(debug).toMatchObject({ level: "debug", event: "a:debug", data: { y: 2 } });
    expect(warn).toMatchObject({ level: "warn", event: "a:warn" });
    expect(error).toMatchObject({ level: "error", event: "a:error", data: { z: 3 } });
    for (const entry of state.entries) {
      expect(typeof entry.ts).toBe("number");
      expect(entry.ts).toBeGreaterThanOrEqual(before);
      expect(entry.ts).toBeLessThanOrEqual(after);
    }
  });

  it("entries fan out to every registered sink in registration order", () => {
    const { state, api } = setup();
    const order: string[] = [];
    state.sinks.push(
      { write: e => order.push(`first:${e.event}`) },
      { write: e => order.push(`second:${e.event}`) }
    );

    api.info("fan:out");

    expect(order).toEqual(["first:fan:out", "second:fan:out"]);
  });

  it("error() merges { error: { message, stack } } into object data, preserving keys", () => {
    const { state, api } = setup();
    const err = new Error("boom");
    api.error("deploy:failed", { target: "cloudflare-pages" }, err);

    const entry = state.entries[0] as LogEntry;
    const data = entry.data as { target: string; error: { message: string; stack?: string } };
    expect(data.target).toBe("cloudflare-pages");
    expect(data.error.message).toBe("boom");
    expect(data.error.stack).toBe(err.stack);
  });

  it("error() with non-object data + Error yields { error: {...} } without throwing", () => {
    const { state, api } = setup();
    const err = new Error("kaboom");
    expect(() => api.error("oops", "a string payload", err)).not.toThrow();

    const entry = state.entries[0] as LogEntry;
    const data = entry.data as { error: { message: string }; [k: string]: unknown };
    expect(data.error.message).toBe("kaboom");
    expect(data).not.toHaveProperty("0"); // string was not spread char-by-char
  });

  it("error() without an Error records data unchanged", () => {
    const { state, api } = setup();
    const payload = { reason: "no config" };
    api.error("build:skip", payload);

    const entry = state.entries[0] as LogEntry;
    expect(entry.data).toEqual({ reason: "no config" });
    expect(entry.data).not.toHaveProperty("error");
  });

  it("addSink registers a sink that receives subsequent entries only", () => {
    const { state, api } = setup();
    api.info("before:sink");
    const received: string[] = [];
    api.addSink({ write: e => received.push(e.event) });
    api.info("after:sink");

    expect(state.sinks).toHaveLength(1);
    expect(received).toEqual(["after:sink"]);
  });
});
