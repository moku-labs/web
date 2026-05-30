import { describe, expect, it, vi } from "vitest";
import { spaEvents } from "../../events";

describe("spaEvents", () => {
  it("registers the four spa events with descriptions", () => {
    const register = vi.fn((description: string) => ({ description }));
    const events = spaEvents(register as never);
    expect(Object.keys(events)).toEqual([
      "spa:navigate",
      "spa:navigated",
      "spa:component-mount",
      "spa:component-unmount"
    ]);
    expect(register).toHaveBeenCalledTimes(4);
  });
});
