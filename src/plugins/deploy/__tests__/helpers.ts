/**
 * Shared test helpers for the deploy plugin: a mock DeployPluginContext factory
 * and a fake spawn builder, so run()-level tests never invoke the real wrangler.
 */
import { vi } from "vitest";
import type { DeployPluginContext } from "../api";
import type { Config, SpawnFunction, State } from "../types";

/** Build a complete deploy Config with sensible test defaults, overridable per call. */
export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    target: "cloudflare-pages",
    outDir: "dist",
    productionBranch: "main",
    scrubAllowlist: ["CLOUDFLARE_ACCOUNT_ID"],
    compatibilityDate: "2024-01-01",
    ci: false,
    ...overrides
  };
}

/** Wrap text into a `"pipe"`-shaped ReadableStream of UTF-8 bytes. */
function streamOf(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body as ReadableStream<Uint8Array>;
}

/**
 * Build a fake SpawnFunction returning the given stdout/stderr/exit. Records every
 * invocation's argv + env so tests can assert no shell string and no token leak.
 */
export function makeSpawn(result: { stdout?: string; stderr?: string; exitCode?: number }): {
  spawn: SpawnFunction;
  calls: { cmd: string[]; env: Record<string, string | undefined> }[];
} {
  const calls: { cmd: string[]; env: Record<string, string | undefined> }[] = [];
  const spawn: SpawnFunction = (cmd, options) => {
    const env = (options.env ?? {}) as Record<string, string | undefined>;
    calls.push({ cmd, env });
    return {
      stdout: streamOf(result.stdout ?? ""),
      stderr: streamOf(result.stderr ?? ""),
      exited: Promise.resolve(result.exitCode ?? 0)
      // The deploy plugin only reads stdout/stderr/exited from the handle.
    } as unknown as ReturnType<SpawnFunction>;
  };
  return { spawn, calls };
}

/** A spy logger satisfying the deploy context's `log` slice. */
export function makeLog() {
  return { info: vi.fn() };
}

/**
 * Build a mock DeployPluginContext. `spawn` is injected into state; `siteName`
 * feeds the slug; `token` is returned by `env.require`. `emit` and `log.info`
 * are spies so tests can assert emissions and the secret-leak guard.
 */
export function makeCtx(options: {
  config?: Partial<Config>;
  spawn: SpawnFunction;
  siteName?: string;
  token?: string;
}): DeployPluginContext & {
  emit: ReturnType<typeof vi.fn>;
  log: { info: ReturnType<typeof vi.fn> };
  state: State;
} {
  const config = makeConfig(options.config);
  const emit = vi.fn();
  const log = makeLog();
  const state: State = {
    // eslint-disable-next-line unicorn/no-null -- State.lastDeployment is `DeployResult | null` by contract.
    lastDeployment: null,
    spawn: options.spawn
  };
  const siteApi = {
    name: () => options.siteName ?? "My Site",
    url: () => "https://example.dev",
    author: () => "Tester",
    description: () => "desc",
    canonical: (p: string) => `https://example.dev${p}`
  };
  const ctx = {
    state,
    config,
    log,
    env: {
      require: (key: string) => {
        if (key === "CLOUDFLARE_API_TOKEN") return options.token ?? "test-token";
        throw new Error(`unexpected env.require(${key})`);
      }
    },
    emit: emit as unknown as DeployPluginContext["emit"],
    require: (() => siteApi) as unknown as DeployPluginContext["require"]
  } satisfies DeployPluginContext;
  return Object.assign(ctx, { emit, log, state });
}
