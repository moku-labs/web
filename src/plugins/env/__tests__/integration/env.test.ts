import { describe, it } from "vitest";

describe("env integration", () => {
  it.todo("createCoreConfig with a real schema resolves and constructs the app");
  it.todo("a sibling plugin reads ctx.env.get/require/has/getPublic/getPublicMap");
  it.todo("two createApp calls produce independent frozen resolved maps");
  it.todo("Cloudflare per-request freshness reflects a changed global on re-resolve");
});
