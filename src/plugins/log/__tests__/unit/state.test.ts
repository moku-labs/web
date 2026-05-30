import { describe, expect, it } from "vitest";
import { createLogApi } from "../../api";
import { createLogState } from "../../state";

describe("log state", () => {
  it("createLogState returns fresh { entries: [], sinks: [] }", () => {
    const state = createLogState({ config: { mode: "test" } });
    expect(state).toEqual({ entries: [], sinks: [] });
    expect(Array.isArray(state.entries)).toBe(true);
    expect(Array.isArray(state.sinks)).toBe(true);
  });

  it("two createLogState results do not share entries or sinks", () => {
    const a = createLogState({ config: { mode: "test" } });
    const b = createLogState({ config: { mode: "test" } });
    a.entries.push({ level: "info", event: "a:one", ts: 1 });
    a.sinks.push({ write: () => {} });
    expect(b.entries).toHaveLength(0);
    expect(b.sinks).toHaveLength(0);
    expect(a.entries).not.toBe(b.entries);
    expect(a.sinks).not.toBe(b.sinks);
  });

  it("reset() clears entries but leaves sinks intact (sink still receives post-reset entries)", () => {
    const state = createLogState({ config: { mode: "test" } });
    const received: string[] = [];
    state.sinks.push({ write: e => received.push(e.event) });
    const api = createLogApi({ config: { mode: "test" }, state });

    api.info("before:reset");
    expect(state.entries).toHaveLength(1);

    api.reset();
    expect(state.entries).toHaveLength(0);
    expect(state.sinks).toHaveLength(1);

    api.info("after:reset");
    expect(state.entries).toHaveLength(1);
    expect(received).toEqual(["before:reset", "after:reset"]);
  });
});
