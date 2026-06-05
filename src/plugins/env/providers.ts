/**
 * @file env plugin — built-in providers: dotenv, processEnv, cloudflareBindings.
 */
import { existsSync, readFileSync } from "node:fs";
import type { EnvProvider } from "./types";

/** Default dotenv file path: optional local overrides. */
const DEFAULT_DOTENV_PATH = ".env.local";
/** Property on `globalThis` that the consumer sets per Cloudflare request. */
const CLOUDFLARE_GLOBAL = "__CLOUDFLARE_ENV__";
/** `String.indexOf` sentinel meaning "no `=` separator on this line". */
const NO_SEPARATOR = -1;

/**
 * Strips a single matching pair of surrounding double or single quotes from a
 * value. Leaves unquoted values (and trailing inline comments) untouched.
 *
 * @param value - The already-trimmed raw value.
 * @returns The value with one outer quote pair removed, if present.
 * @example
 * ```ts
 * stripQuotes('"a"'); // "a"
 * stripQuotes("plain # c"); // "plain # c"
 * ```
 */
function stripQuotes(value: string): string {
  if (value.length < 2) return value;

  const first = value[0];
  const last = value.at(-1);
  if ((first === '"' || first === "'") && first === last) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Reports whether a trimmed line carries no assignment — a blank line or a
 * full-line `#` comment — and should be skipped by the parser.
 *
 * @param trimmed - A whitespace-trimmed line from the dotenv text.
 * @returns `true` when the line is empty or a comment.
 * @example
 * ```ts
 * isIgnoredLine(""); // true
 * isIgnoredLine("# note"); // true
 * isIgnoredLine("A=1"); // false
 * ```
 */
function isIgnoredLine(trimmed: string): boolean {
  return trimmed === "" || trimmed.startsWith("#");
}

/**
 * Parses `.env`-style text into a flat record. Handles CRLF/LF, blank lines,
 * full-line `#` comments, first-`=` splitting, key/value trimming, and a single
 * outer quote pair. Does not strip trailing inline comments on unquoted values.
 *
 * @param text - The raw file contents.
 * @returns A flat record of parsed key/value pairs.
 * @example
 * ```ts
 * parseDotenv('A=1\nB="two"'); // { A: "1", B: "two" }
 * ```
 */
function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    // Skip lines that hold no assignment: blanks and full-line comments.
    const trimmed = line.trim();
    if (isIgnoredLine(trimmed)) continue;

    // The first `=` is the key/value boundary; a line without one is malformed.
    const eq = trimmed.indexOf("=");
    if (eq === NO_SEPARATOR) continue;

    // Trim both sides, strip one outer quote pair off the value, and record it.
    const key = trimmed.slice(0, eq).trim();
    const value = stripQuotes(trimmed.slice(eq + 1).trim());
    out[key] = value;
  }
  return out;
}

/**
 * A zero-dependency `.env`-style provider that re-reads and re-parses the file
 * from disk on every `load()`. Missing file resolves to `{}` (optional
 * overrides). Strips a single outer quote pair; does not strip trailing inline
 * comments on unquoted values.
 *
 * @param path - Path to the dotenv file. Defaults to `.env.local`.
 * @returns An {@link EnvProvider} named `dotenv:<path>` that reads fresh per call.
 * @example
 * ```ts
 * const provider = dotenv(".env.local");
 * provider.load(); // { PUBLIC_API_URL: "/api", ... }
 * ```
 */
export function dotenv(path: string = DEFAULT_DOTENV_PATH): EnvProvider {
  return {
    name: `dotenv:${path}`,
    /**
     * Reads and parses the dotenv file fresh from disk; `{}` if it is missing.
     *
     * @returns The parsed environment record, or `{}` when the file is absent.
     * @example
     * ```ts
     * dotenv(".env.local").load();
     * ```
     */
    load(): Record<string, string | undefined> {
      if (!existsSync(path)) return {};
      return parseDotenv(readFileSync(path, "utf8"));
    }
  };
}

/**
 * A provider that returns a shallow copy of `process.env` at `load()` time.
 *
 * @returns An {@link EnvProvider} named `process-env`.
 * @example
 * ```ts
 * const provider = processEnv();
 * provider.load().HOME; // current process value
 * ```
 */
export function processEnv(): EnvProvider {
  return {
    name: "process-env",
    /**
     * Returns a shallow copy of `process.env` at call time.
     *
     * @returns A fresh shallow copy of `process.env`.
     * @example
     * ```ts
     * processEnv().load();
     * ```
     */
    load(): Record<string, string | undefined> {
      return { ...process.env };
    }
  };
}

/**
 * A provider that reads live, per-request Cloudflare bindings from
 * `globalThis.__CLOUDFLARE_ENV__` at `load()` time (`?? {}` when absent). Never
 * caches the binding object; the consumer owns the global's request lifecycle.
 *
 * @returns An {@link EnvProvider} named `cloudflare`.
 * @example
 * ```ts
 * globalThis.__CLOUDFLARE_ENV__ = env; // set by the request handler
 * const provider = cloudflareBindings();
 * provider.load(); // reads the current request's bindings
 * ```
 */
export function cloudflareBindings(): EnvProvider {
  return {
    name: "cloudflare",
    /**
     * Reads `globalThis.__CLOUDFLARE_ENV__` fresh, never caching the bindings.
     *
     * @returns The current Cloudflare bindings, or `{}` when the global is unset.
     * @example
     * ```ts
     * cloudflareBindings().load();
     * ```
     */
    load(): Record<string, string | undefined> {
      const bindings = (globalThis as Record<string, unknown>)[CLOUDFLARE_GLOBAL];
      return (bindings as Record<string, string | undefined>) ?? {};
    }
  };
}
