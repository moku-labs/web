import { describe, it } from "vitest";

describe("env/providers", () => {
  it.todo("dotenv parses double- and single-quoted values");
  it.todo("dotenv skips comment lines and blank lines");
  it.todo("dotenv does not strip trailing inline comments on unquoted values");
  it.todo("dotenv handles CRLF and LF line endings");
  it.todo("dotenv trims keys and values");
  it.todo("dotenv returns {} for a missing file");
  it.todo("processEnv reflects process.env at load() time");
  it.todo("cloudflareBindings reads globalThis.__CLOUDFLARE_ENV__ at load()");
  it.todo("cloudflareBindings returns {} when the global is absent");
  it.todo("cloudflareBindings reads fresh after the global changes (no caching)");
});
