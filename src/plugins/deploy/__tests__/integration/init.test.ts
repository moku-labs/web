import { describe, it } from "vitest";

describe("deploy init integration", () => {
  it.todo("writes wrangler.jsonc (+ deploy.yml when ci) in a fresh temp dir");
  it.todo("derives the slug from a stubbed site.name()");
  it.todo("is idempotent — never overwrites an existing wrangler.jsonc");
  it.todo("reports drift in check mode without writing");
});
