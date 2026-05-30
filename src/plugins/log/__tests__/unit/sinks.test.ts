import { describe, it } from "vitest";

describe("log console sink routing", () => {
  it.todo("error -> console.error, warn -> console.warn, debug/info -> console.log");
  it.todo("each call serializes the entry");
  it.todo("test/silent install no console sink; dev/production install a console sink");
  it.todo("trace records entries in all four modes");
});
