import { describe, it } from "vitest";

describe("spa components", () => {
  it.todo("createComponent throws on unknown hook key and on empty name");
  it.todo("hook firing order: onCreate then onMount on mount");
  it.todo("scanAndMount emits spa:component-mount with { name, el }");
  it.todo("unmountPageSpecific emits spa:component-unmount and runs onUnMount then onDestroy");
});
