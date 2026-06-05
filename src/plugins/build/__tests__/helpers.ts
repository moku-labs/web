/**
 * Shared unit-test helpers for the build plugin: a mock PhaseContext factory and
 * small fake dependency APIs. Keeps each phase test focused on its own behavior.
 */
import { vi } from "vitest";
import type { Article } from "../../content/types";
import type { Config, PhaseContext } from "../types";

/** Build a complete Config with sensible test defaults, overridable per call. */
export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    outDir: "./.tmp-test-out",
    minify: true,
    feeds: true,
    sitemap: true,
    images: false,
    ogImage: false,
    ...overrides
  };
}

/** A no-op logger satisfying the PhaseLog slice. */
export function makeLog() {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * Build a mock PhaseContext. `requireMap` maps a plugin's `name` to its fake API;
 * `emit` and `log` are spies so tests can assert emissions/logging.
 */
export function makeCtx(options: {
  config?: Partial<Config>;
  requireMap?: Record<string, unknown>;
  runId?: string;
}): PhaseContext & { emit: ReturnType<typeof vi.fn> } {
  const config = makeConfig(options.config);
  const requireMap = options.requireMap ?? {};
  const emit = vi.fn();
  const ctx = {
    state: {
      config,
      // eslint-disable-next-line unicorn/no-null -- State.manifest is `RouteDefinition[] | null`
      manifest: null,
      buildCache: new Map<string, unknown>(),
      runId: options.runId ?? "test-run",
      ogImageHashCache: new Map<string, string>()
    },
    config,
    global: { isDevelopment: false },
    require: ((plugin: { name: string }) => requireMap[plugin.name]) as PhaseContext["require"],
    has: (name: string) => name in requireMap,
    emit: emit as unknown as PhaseContext["emit"],
    log: makeLog()
  } satisfies PhaseContext;
  return Object.assign(ctx, { emit });
}

/** Minimal published Article fixture for content-dependent phase tests. */
export function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    frontmatter: {
      title: "Hello World",
      date: "2026-01-15",
      description: "Intro",
      tags: [],
      language: "en"
    },
    computed: {
      slug: "hello-world",
      readingTime: 1,
      contentId: "hello-world",
      status: "published",
      wordCount: 42
    },
    html: "<h1>Hello</h1>",
    locale: "en",
    isFallback: false,
    url: "/en/hello-world/",
    ...overrides
  };
}
