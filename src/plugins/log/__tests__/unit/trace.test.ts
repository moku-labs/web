import { describe, expect, it } from "vitest";
import { createLogApi } from "../../api";
import { createLogState } from "../../state";

/**
 * Build a fresh api bound to fresh state.
 *
 * @returns The api under test.
 */
function makeApi(): ReturnType<typeof createLogApi> {
  const state = createLogState({ config: { mode: "test" } });
  return createLogApi({ config: { mode: "test" }, state });
}

describe("log trace vs expect snapshot semantics", () => {
  it("trace() returns a frozen array (Object.isFrozen)", () => {
    const api = makeApi();
    api.info("one");
    const snapshot = api.trace();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => {
      (snapshot as unknown as { push: (x: unknown) => void }).push({});
    }).toThrow();
  });

  it("trace() is a copy — mutating state after capture does not change a prior snapshot", () => {
    const api = makeApi();
    api.info("first");
    const snapshot = api.trace();
    expect(snapshot).toHaveLength(1);
    api.info("second");
    expect(snapshot).toHaveLength(1);
    expect(api.trace()).toHaveLength(2);
  });

  it("a snapshot captured before a later info() does NOT contain the later entry", () => {
    const api = makeApi();
    api.info("early");
    const snapshot = api.trace();
    api.info("late");
    expect(snapshot.map(e => e.event)).toEqual(["early"]);
  });

  it("expect() sees entries logged after the chain was created (live-read)", () => {
    const api = makeApi();
    const chain = api.expect();
    api.info("live:event");
    expect(() => chain.toHaveEvent("live:event")).not.toThrow();
  });
});
