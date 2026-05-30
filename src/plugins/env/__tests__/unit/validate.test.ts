import { describe, it } from "vitest";

describe("env/validate", () => {
  it.todo("merges providers first-non-undefined-wins in array order");
  it.todo("coerces empty-string values to undefined before precedence");
  it.todo("throws when public:true on a non-PUBLIC_ key");
  it.todo("throws when a PUBLIC_-named key lacks public:true");
  it.todo("respects a custom publicPrefix");
  it.todo("applies defaults only when a key is unresolved");
  it.todo("throws naming the variable when a required key has no value");
  it.todo("populates resolved and publicMap then freezes both");
  it.todo("freezeMap makes set/clear/delete throw");
  it.todo("freezeMap mutator redefinitions are non-configurable");
});
