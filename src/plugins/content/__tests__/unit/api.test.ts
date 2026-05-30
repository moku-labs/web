import { describe, it } from "vitest";

describe("content/api", () => {
  it.todo("articleToCard projects an Article to the lightweight card shape");
  it.todo("loadAll emits content:ready with { locales, articleCount }");
  it.todo("invalidate adds paths to dirtyPaths and removes slug cache entry");
  it.todo("invalidate ignores empty/whitespace paths and emits content:invalidated");
  it.todo("processor is a singleton per app (reused across renders; new app gets its own)");
  it.todo("load uses default-locale file with isFallback=true when locale missing");
  it.todo("drafts are excluded in production mode, included in development");
});
