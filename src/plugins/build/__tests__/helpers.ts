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
 * A mock core `env` API over a plain record. `vars` seeds the resolved
 * variables tests read via `ctx.env.get(...)`; public-prefixed keys
 * (`PUBLIC_*`) surface through `getPublic`/`getPublicMap`.
 */
export function makeEnv(vars: Record<string, string> = {}): PhaseContext["env"] {
  const publicEntries = Object.entries(vars).filter(([key]) => key.startsWith("PUBLIC_"));
  return {
    get: (key: string) => vars[key],
    require: (key: string) => {
      const value = vars[key];
      if (value === undefined) throw new Error(`env: required variable "${key}" is not defined.`);
      return value;
    },
    has: (key: string) => vars[key] !== undefined,
    getPublic: () => Object.freeze(Object.fromEntries(publicEntries)),
    getPublicMap: () => new Map(publicEntries)
  };
}

/**
 * Build a mock PhaseContext. `requireMap` maps a plugin's `name` to its fake API;
 * `emit` and `log` are spies so tests can assert emissions/logging.
 */
export function makeCtx(options: {
  config?: Partial<Config>;
  requireMap?: Record<string, unknown>;
  runId?: string;
  envVars?: Record<string, string>;
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
      ogImageHashCache: new Map<string, string>(),
      renderCache: new Map()
    },
    config,
    global: { stage: "production" },
    require: ((plugin: { name: string }) => requireMap[plugin.name]) as PhaseContext["require"],
    has: (name: string) => name in requireMap,
    emit: emit as unknown as PhaseContext["emit"],
    log: makeLog(),
    env: makeEnv(options.envVars)
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
