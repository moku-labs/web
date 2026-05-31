import { afterEach, describe, expect, it } from "vitest";
import { browserEnv } from "../../providers.browser";

/**
 * Vitest seeds a read-only `import.meta.env` (BASE_URL, DEV, MODE, PROD, SSR)
 * that test code cannot reassign, so these tests assert the merge against those
 * real seeded keys and fully control only the runtime global.
 */
const importEnv = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__ENV__;
  delete (globalThis as Record<string, unknown>).CUSTOM_ENV;
});

describe("env/providers.browser", () => {
  it("has the provider name browser-env", () => {
    expect(browserEnv().name).toBe("browser-env");
  });

  it("reads the stubbed globalThis.__ENV__ snapshot", () => {
    (globalThis as Record<string, unknown>).__ENV__ = { PUBLIC_KEY: "global-value" };
    expect(browserEnv().load().PUBLIC_KEY).toBe("global-value");
  });

  it("returns only import.meta.env (no extra keys) when the global is absent", () => {
    expect(browserEnv().load()).toEqual(importEnv);
  });

  it("merges import.meta.env with the runtime global", () => {
    (globalThis as Record<string, unknown>).__ENV__ = { FROM_GLOBAL: "global-value" };
    const out = browserEnv().load();
    // Every import.meta.env key is preserved...
    for (const [key, value] of Object.entries(importEnv)) {
      expect(out[key]).toBe(value);
    }
    // ...alongside the runtime global's keys.
    expect(out.FROM_GLOBAL).toBe("global-value");
  });

  it("lets the runtime global win over import.meta.env on key collision", () => {
    const collisionKey = Object.keys(importEnv)[0] ?? "MODE";
    (globalThis as Record<string, unknown>).__ENV__ = { [collisionKey]: "from-global" };
    expect(browserEnv().load()[collisionKey]).toBe("from-global");
  });

  it("never throws and yields no extra keys when the runtime global is absent", () => {
    // With no global set (and the vitest-seeded import.meta.env possibly empty),
    // load() falls back to `?? {}` per source and never throws.
    expect(() => browserEnv({ globalKey: "DOES_NOT_EXIST" }).load()).not.toThrow();
    expect(browserEnv({ globalKey: "DOES_NOT_EXIST" }).load()).toEqual(importEnv);
  });

  it("reads from a custom globalKey", () => {
    (globalThis as Record<string, unknown>).CUSTOM_ENV = { CUSTOM: "custom-value" };
    expect(browserEnv({ globalKey: "CUSTOM_ENV" }).load().CUSTOM).toBe("custom-value");
  });
});
