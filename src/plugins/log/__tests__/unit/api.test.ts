import { describe, it } from "vitest";

describe("log api", () => {
  it.todo("info/debug/warn/error append one entry with correct level, event, data, numeric ts");
  it.todo("entries fan out to every registered sink in registration order");
  it.todo("error() merges { error: { message, stack } } into object data, preserving keys");
  it.todo("error() with non-object data + Error yields { error: {...} } without throwing");
  it.todo("error() without an Error records data unchanged");
});
