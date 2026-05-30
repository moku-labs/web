import { describe, it } from "vitest";

describe("log trace vs expect snapshot semantics", () => {
  it.todo("trace() returns a frozen array (Object.isFrozen)");
  it.todo("trace() is a copy — mutating state after capture does not change a prior snapshot");
  it.todo("a snapshot captured before a later info() does NOT contain the later entry");
  it.todo("expect() sees entries logged after the chain was created (live-read)");
});
