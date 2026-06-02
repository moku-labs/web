#!/usr/bin/env bun
/**
 * @file Post-build gate for the `@moku-labs/web/browser` entry. Run with `bun`.
 *
 * The browser entry promises a client bundle with zero node/native code. This gate
 * proves it against the BUILT `dist/browser.mjs`, then reports its shipped size:
 *
 *   1. no-node-leak — no STATIC import of node/native code anywhere in the entry's
 *      static-import closure;
 *   2. writer-is-dynamic — the data plugin's `node:fs` writer chunk is reachable
 *      only via dynamic `import(...)`, never statically;
 *   3. size-budget — the static closure (summed per-file gzip) stays under
 *      {@link SIZE_BUDGET_BYTES}.
 *
 * Static vs dynamic is the whole point: a static `import x from "node:fs"` ships node
 * code to the client, while a dynamic `import("node:fs")` is split into a chunk the
 * browser never loads. We follow and scan static specifiers only.
 *
 * Wired into CI's `build` job (the only job that produces `dist/`) and runnable
 * locally via `bun run check:bundle`. Node built-ins only — no dependencies.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// ───────────────────────────── Configuration ─────────────────────────────

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const BROWSER_ENTRY = resolve(DIST, "browser.mjs");
const NODE_ENTRY = resolve(DIST, "index.mjs");

/** A STATIC import of any of these into the browser graph is a node/native leak. */
const BANNED_SPECIFIERS: readonly RegExp[] = [
  /^node:/,
  /^@resvg\//,
  /^satori$/,
  /^gray-matter$/,
  /^feed$/,
  /^@shikijs\//,
  /^shiki$/,
  /^unified$/,
  /^remark[-/]/,
  /^rehype[-/]/,
  /^hast-util/,
  /^unist-util/,
  /^reading-time$/,
  /^p-limit$/
];

/** Budget for the static closure, measured as the sum of each file's gzip size (~36 kB). */
const SIZE_BUDGET_BYTES = 45 * 1024;

// ──────────────────────────────── Types ──────────────────────────────────

/** A bundle file paired with its gzipped transfer size. */
interface SizedFile {
  /** Path relative to `dist/`, for display. */
  readonly path: string;
  /** gzipped size in bytes. */
  readonly gzipBytes: number;
}

/** The complete, side-effect-free result of analyzing the browser entry. */
interface GateReport {
  /** Raw byte size of `dist/browser.mjs`. */
  readonly entryRawBytes: number;
  /** gzipped size of `dist/browser.mjs`. */
  readonly entryGzipBytes: number;
  /** Every file in the entry's static-import closure (sorted), with gzip sizes. */
  readonly closure: readonly SizedFile[];
  /** Sum of each closure file's individual gzip size — what a client downloads. */
  readonly closureGzipBytes: number;
  /** The Node entry's sizes for contrast, or `null` when it has not been built. */
  readonly nodeEntry: { readonly rawBytes: number; readonly gzipBytes: number } | null;
  /** Human-readable gate violations; empty when the bundle is clean. */
  readonly problems: readonly string[];
}

/** A static-import closure: each file mapped to the specifiers it statically imports. */
type Closure = ReadonlyMap<string, readonly string[]>;

// ───────────────────────── Static-import analysis ─────────────────────────

/**
 * Extracts the STATIC ESM import AND re-export specifiers from module source.
 *
 * Matches `import … from "x"` (default/named/namespace), side-effect `import "x"`,
 * and `export … from "x"`. Dynamic `import("x")` is never matched: the from-based
 * patterns require a `from` keyword (which dynamic import lacks), and the side-effect
 * pattern's `\s+` cannot cross the `(`.
 *
 * Detection assumes bundler output — static imports hoisted to the top of each chunk,
 * one per line at column 0 — which is the only kind of source this gate scans.
 *
 * @param code - Module source text (a built `dist/` chunk).
 * @returns The specifier of every static import/re-export, in source order.
 */
function staticSpecifiers(code: string): string[] {
  const patterns = [
    // `import … from "x"` (default / named / namespace)
    /(?:^|[;\n}])\s*import\b[^'"()]*?\bfrom\s*["']([^"']+)["']/g,
    // side-effect `import "x"` — the `\s+` after `import` excludes dynamic `import("x")`
    /(?:^|[;\n}])\s*import\s+["']([^"']+)["']/g,
    // `export … from "x"`
    /(?:^|[;\n}])\s*export\b[^'"()]*?\bfrom\s*["']([^"']+)["']/g
  ];
  return patterns.flatMap((re) =>
    [...code.matchAll(re)]
      .map((match) => match[1])
      .filter((specifier): specifier is string => specifier !== undefined)
  );
}

/**
 * Resolves a relative import specifier to an absolute file inside `dist/`.
 *
 * @param specifier - The import specifier (e.g. `"./chunk.mjs"` or `"node:fs"`).
 * @param fromFile - Absolute path of the importing file, for relative resolution.
 * @returns The absolute local path, or `null` for bare/package specifiers and for
 *   relative paths that do not resolve to an existing file.
 */
function resolveLocalImport(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const target = resolve(dirname(fromFile), specifier);
  return existsSync(target) ? target : null;
}

/**
 * Walks the STATIC-import closure of an entry file, parsing each reached file exactly
 * once. Only static edges are followed — dynamic `import(...)` chunks are excluded,
 * which is exactly how node-only code is kept out of the browser graph.
 *
 * @param entry - Absolute path of the entry module.
 * @returns A map from each absolute file path in the closure (including `entry`) to
 *   the static specifiers it imports — the single source of truth for both the leak
 *   scan and the size report.
 */
function staticClosure(entry: string): Closure {
  const modules = new Map<string, string[]>();
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (modules.has(file)) continue;
    const specifiers = staticSpecifiers(readFileSync(file, "utf8"));
    modules.set(file, specifiers);
    for (const specifier of specifiers) {
      const local = resolveLocalImport(specifier, file);
      if (local !== null) queue.push(local);
    }
  }
  return modules;
}

// ──────────────────────────── Measurement ────────────────────────────────

/**
 * Measures the gzipped size of a file — the realistic over-the-wire transfer cost.
 *
 * @param file - Absolute path of the file.
 * @returns The gzipped size in bytes.
 */
function gzipBytesOf(file: string): number {
  return gzipSync(readFileSync(file)).length;
}

/**
 * Formats a byte count as a `kB` string (base-1024) for the report.
 *
 * @param bytes - A size in bytes.
 * @returns A string like `"34.84 kB"`.
 */
function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} kB`;
}

// ────────────────────────────────── Checks ───────────────────────────────
// Each check is pure: given the closure (or a size) it returns a list of
// human-readable problems — empty when that aspect of the bundle is clean.

/**
 * Finds banned node/native packages STATICALLY imported or re-exported anywhere in
 * the closure — the core leak check. Operates on the already-parsed specifiers, so
 * it re-reads nothing.
 *
 * @param closure - The entry's static-import closure (file → its specifiers).
 * @returns One message per offending file, or an empty array when clean.
 */
function findNodeLeaks(closure: Closure): string[] {
  const leaks: string[] = [];
  for (const [file, specifiers] of closure) {
    const banned = specifiers.filter((spec) => BANNED_SPECIFIERS.some((pattern) => pattern.test(spec)));
    if (banned.length > 0) {
      leaks.push(`${relative(DIST, file)} statically imports → ${[...new Set(banned)].join(", ")}`);
    }
  }
  return leaks;
}

/**
 * Asserts the data plugin's `node:fs` `writer-*` chunk never enters the static
 * closure — it must stay reachable only via dynamic `import(...)`. A defensive
 * belt-and-suspenders that relies on rolldown naming the chunk `writer-*.mjs`
 * (`findNodeLeaks` already catches it via its `node:` imports today).
 *
 * @param files - The closure's file paths.
 * @returns One message per writer chunk found statically, or an empty array.
 */
function findStaticWriterChunk(files: Iterable<string>): string[] {
  return [...files]
    .filter((file) => /(?:^|\/)writer-[^/]*\.mjs$/.test(file))
    .map((file) => `static closure includes the node writer chunk ${basename(file)} (must be dynamic-only)`);
}

/**
 * Checks the summed per-file gzip size of the static closure against
 * {@link SIZE_BUDGET_BYTES}.
 *
 * @param closureGzipBytes - Total gzipped size of the static closure.
 * @returns A single over-budget message, or an empty array when within budget.
 */
function checkSizeBudget(closureGzipBytes: number): string[] {
  if (closureGzipBytes <= SIZE_BUDGET_BYTES) return [];
  return [`static closure ${formatKb(closureGzipBytes)} gz exceeds budget ${formatKb(SIZE_BUDGET_BYTES)} gz`];
}

// ────────────────────────────── Orchestration ────────────────────────────

/**
 * Analyzes the built browser entry into a {@link GateReport} — pure data, no output.
 * The caller must ensure {@link BROWSER_ENTRY} exists.
 *
 * @returns The closure, its sizes, the Node-entry contrast, and any gate problems.
 */
function analyzeBrowserBundle(): GateReport {
  const closure = staticClosure(BROWSER_ENTRY);
  const sizedClosure: SizedFile[] = [...closure.keys()]
    .sort()
    .map((file) => ({ path: relative(DIST, file), gzipBytes: gzipBytesOf(file) }));
  const closureGzipBytes = sizedClosure.reduce((total, file) => total + file.gzipBytes, 0);

  return {
    entryRawBytes: readFileSync(BROWSER_ENTRY).length,
    entryGzipBytes: gzipBytesOf(BROWSER_ENTRY),
    closure: sizedClosure,
    closureGzipBytes,
    nodeEntry: existsSync(NODE_ENTRY)
      ? { rawBytes: readFileSync(NODE_ENTRY).length, gzipBytes: gzipBytesOf(NODE_ENTRY) }
      : null,
    problems: [
      ...findNodeLeaks(closure),
      ...findStaticWriterChunk(closure.keys()),
      ...checkSizeBudget(closureGzipBytes)
    ]
  };
}

/**
 * Builds the human-readable bundle report — entry size, the per-file static closure,
 * and the Node-entry contrast — as one block of text, blank lines included. Column
 * width adapts to the longest path so the size column always aligns.
 *
 * @param report - The analyzed {@link GateReport}.
 * @returns The formatted report, ready to print in a single call.
 */
function formatReport(report: GateReport): string {
  const pathWidth = Math.max(...report.closure.map((file) => file.path.length));
  const lines = [
    "browser bundle gate — static graph = what a client actually ships",
    "",
    `  entry   dist/browser.mjs   ${formatKb(report.entryRawBytes)} raw / ${formatKb(report.entryGzipBytes)} gz`,
    `  static closure (${report.closure.length} files):   ${formatKb(report.closureGzipBytes)} gz   (budget ${formatKb(SIZE_BUDGET_BYTES)} gz)`,
    ...report.closure.map((file) => `    ${file.path.padEnd(pathWidth)}   ${formatKb(file.gzipBytes).padStart(10)} gz`)
  ];
  if (report.nodeEntry !== null) {
    lines.push("", `  contrast  dist/index.mjs (Node entry)   ${formatKb(report.nodeEntry.rawBytes)} raw / ${formatKb(report.nodeEntry.gzipBytes)} gz`);
  }
  return lines.join("\n");
}

/**
 * Formats the gate failure block: the header plus one indented line per problem.
 *
 * @param problems - The gate violations (must be non-empty).
 * @returns The formatted failure message.
 */
function formatFailure(problems: readonly string[]): string {
  return ["❌ browser bundle gate FAILED:", ...problems.map((problem) => `   - ${problem}`)].join("\n");
}

const PASS_MESSAGE = "✅ browser bundle gate passed — zero static node/native imports, under size budget.";

/**
 * Entry point: guards that the bundle is built, analyzes it, prints the report, and
 * sets a non-zero exit code if any gate problem is found.
 */
function main(): void {
  if (!existsSync(BROWSER_ENTRY)) {
    console.error("\n❌ dist/browser.mjs not found — run `bun run build` first.\n");
    process.exitCode = 1;
    return;
  }

  const report = analyzeBrowserBundle();
  console.log(`\n${formatReport(report)}\n`);

  if (report.problems.length > 0) {
    console.error(`${formatFailure(report.problems)}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`${PASS_MESSAGE}\n`);
}

main();
