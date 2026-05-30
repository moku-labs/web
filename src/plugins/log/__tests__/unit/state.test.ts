import { describe, it } from "vitest";

describe("log state", () => {
  it.todo("createLogState returns fresh { entries: [], sinks: [] }");
  it.todo("two createLogState results do not share entries or sinks");
  it.todo("reset() clears entries but leaves sinks intact");
});
