import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cloudflareBindings, dotenv, processEnv } from "../../providers";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "env-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete (globalThis as Record<string, unknown>).__CLOUDFLARE_ENV__;
});

/** Writes a .env file in the temp dir and returns its path. */
function writeEnv(contents: string): string {
  const filePath = path.join(tmp, ".env.local");
  writeFileSync(filePath, contents);
  return filePath;
}

describe("env/providers", () => {
  it("dotenv parses double- and single-quoted values", () => {
    const provider = dotenv(writeEnv(`A="double"\nB='single'`));
    const out = provider.load();
    expect(out.A).toBe("double");
    expect(out.B).toBe("single");
  });

  it("dotenv skips comment lines and blank lines", () => {
    const provider = dotenv(writeEnv(`# a comment\n\nKEY=value\n   # indented comment\n`));
    const out = provider.load();
    expect(out.KEY).toBe("value");
    expect(Object.keys(out)).toEqual(["KEY"]);
  });

  it("dotenv does not strip trailing inline comments on unquoted values", () => {
    const provider = dotenv(writeEnv(`KEY=value # not a comment`));
    expect(provider.load().KEY).toBe("value # not a comment");
  });

  it("dotenv handles CRLF and LF line endings", () => {
    const provider = dotenv(writeEnv(`A=1\r\nB=2\nC=3`));
    const out = provider.load();
    expect(out.A).toBe("1");
    expect(out.B).toBe("2");
    expect(out.C).toBe("3");
  });

  it("dotenv trims keys and values", () => {
    const provider = dotenv(writeEnv(`  KEY  =  value  `));
    expect(provider.load().KEY).toBe("value");
  });

  it("dotenv yields an empty string for KEY=", () => {
    const provider = dotenv(writeEnv(`KEY=`));
    expect(provider.load().KEY).toBe("");
  });

  it("dotenv skips lines without an equals sign", () => {
    const provider = dotenv(writeEnv(`NOEQUALS\nKEY=value`));
    const out = provider.load();
    expect(out.KEY).toBe("value");
    expect(Object.keys(out)).toEqual(["KEY"]);
  });

  it("dotenv splits on the first equals only", () => {
    const provider = dotenv(writeEnv(`URL=postgres://a=b`));
    expect(provider.load().URL).toBe("postgres://a=b");
  });

  it("dotenv returns {} for a missing file", () => {
    const provider = dotenv(path.join(tmp, "does-not-exist.env"));
    expect(provider.load()).toEqual({});
  });

  it("dotenv re-reads from disk on every load (no cache)", () => {
    const path = writeEnv(`KEY=one`);
    const provider = dotenv(path);
    expect(provider.load().KEY).toBe("one");
    writeFileSync(path, `KEY=two`);
    expect(provider.load().KEY).toBe("two");
  });

  it("dotenv name is dotenv:<path> and defaults to .env.local", () => {
    expect(dotenv().name).toBe("dotenv:.env.local");
    expect(dotenv("/foo/.env").name).toBe("dotenv:/foo/.env");
  });

  it("processEnv reflects process.env at load() time", () => {
    process.env.ENV_TEST_KEY = "process-value";
    const provider = processEnv();
    expect(provider.name).toBe("process-env");
    expect(provider.load().ENV_TEST_KEY).toBe("process-value");
    delete process.env.ENV_TEST_KEY;
  });

  it("cloudflareBindings reads globalThis.__CLOUDFLARE_ENV__ at load()", () => {
    (globalThis as Record<string, unknown>).__CLOUDFLARE_ENV__ = { CF_KEY: "cf-value" };
    const provider = cloudflareBindings();
    expect(provider.name).toBe("cloudflare");
    expect(provider.load().CF_KEY).toBe("cf-value");
  });

  it("cloudflareBindings returns {} when the global is absent", () => {
    expect(cloudflareBindings().load()).toEqual({});
  });

  it("cloudflareBindings reads fresh after the global changes (no caching)", () => {
    const provider = cloudflareBindings();
    (globalThis as Record<string, unknown>).__CLOUDFLARE_ENV__ = { CF_KEY: "first" };
    expect(provider.load().CF_KEY).toBe("first");
    (globalThis as Record<string, unknown>).__CLOUDFLARE_ENV__ = { CF_KEY: "second" };
    expect(provider.load().CF_KEY).toBe("second");
  });
});
