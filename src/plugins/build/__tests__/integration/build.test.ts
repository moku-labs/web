import { describe, it } from "vitest";

describe("build integration", () => {
  it.todo("createApp + app.build.run() produces a dist/ tree");
  it.todo("emits build:phase (per phase, start/done) then build:complete in order");
  it.todo("sitemap URL set matches the route manifest");
  it.todo("feed GUID set matches the content set");
  it.todo("a per-route page exists for every route in the manifest");
  it.todo("rendered pages preserve frontmatter/heading structure");
  it.todo("Shiki highlight classes present in code blocks");
});
