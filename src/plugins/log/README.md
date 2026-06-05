# log

> **Core** — structured logging plus an always-on in-memory trace with an `expect()` DSL for testable, LLM-verifiable workflows.

`log` is a Moku **core plugin** (`createCorePlugin`): its API is injected flat onto every regular plugin's context as `ctx.log`, and surfaced on the app as `app.log`. Every call records a `LogEntry` in an append-only in-memory **trace** (always on) and fans it out to each registered **sink** in registration order. The `expect()` chain turns that trace into assertions — `toHaveEvent` / `toHaveEventInOrder` / `toNotHaveEvent` — so a build or runtime workflow can be verified by what it logged.

Being a core plugin, its context is `{ config, state }` only — **no `depends`, no `events`, no `hooks`**. It runs its `onInit` before every regular plugin, so logging is available throughout the lifecycle, and it owns no external resource (only in-memory arrays + synchronous sinks), so it deliberately has **no `onStart` / `onStop`**. The one load-bearing design decision: the `LogSink` seam — console/file/JSON outputs are pluggable behind a single `write(entry)` interface, so new outputs are added without touching the log API.

## Example
```ts
import { createApp } from "@moku-labs/web";

const app = createApp({
  pluginConfigs: {
    log: { mode: "test" } // trace only, no console noise
  }
});

// Inside a plugin: ctx.log; from the app: app.log
app.log.info("build:phase", { phase: "content", status: "start" });
app.log.warn("build:skip", { reason: "no sitemap" });
app.log.info("build:complete");

// Assert the workflow behaved — throws LogExpectAssertionError on failure
app.log
  .expect()
  .toHaveEvent("build:phase", { phase: "content", status: "start" })
  .toHaveEventInOrder(["build:phase", "build:complete"])
  .toNotHaveEvent("deploy:failed");
```

## API

Reachable as `ctx.log.<method>()` (every regular plugin) and `app.log.<method>()`.

| Method | Signature | Notes |
|---|---|---|
| `info` | `(event: string, data?: unknown) => void` | Append an `info` entry and fan out to every sink. |
| `debug` | `(event: string, data?: unknown) => void` | Append a `debug` entry. |
| `warn` | `(event: string, data?: unknown) => void` | Append a `warn` entry. |
| `error` | `(event: string, data?: unknown, error?: Error) => void` | Append an `error` entry. When `error` is supplied, its `message`/`stack` are merged into `data` under an `error` key (existing keys preserved; non-plain-object `data` is coerced to `{}` first, dropping its original value). |
| `trace` | `() => readonly LogEntry[]` | Return a **frozen snapshot** (fresh copy) of all entries recorded so far. |
| `expect` | `() => ExpectChain` | Return a fluent assertion chain bound to the **live** entries array. |
| `addSink` | `(sink: LogSink) => void` | Register an additional `LogSink` at runtime (the file/JSON seam). |
| `reset` | `() => void` | Clear all recorded entries while **keeping** registered sinks. |

Each `LogEntry` is `{ level, event, data?, ts, plugin? }`, where `ts` is `Date.now()` at append time and `plugin` is reserved for future enrichment. Entries are appended to the in-memory trace first, then written to every registered sink in registration order.

> [!NOTE]
> `trace()` returns a **frozen copy** — later log calls never retroactively appear in a previously returned snapshot, and the result cannot be mutated. `expect()` reads the **live** entries array on every assertion call — a chain created before more logging still sees the newer entries.

### The `expect()` DSL

The crown jewel: assert that a workflow behaved as expected. Every method returns the same chain for fluent chaining; failures throw `LogExpectAssertionError` with a descriptive message (the event name, the JSON-stringified `partial` when present, and the offending index for ordering / negative cases).

| Method | Signature | Asserts |
|---|---|---|
| `toHaveEvent` | `(event, partial?) => ExpectChain` | At least one entry has `event`, optionally matching `partial` (subset match against `entry.data`). |
| `toHaveEventInOrder` | `(events: string[]) => ExpectChain` | All `events` appear in the given relative order (gaps allowed); matched by **event name only**. |
| `toNotHaveEvent` | `(event, partial?) => ExpectChain` | No entry has `event` (optionally narrowed by `partial`). |

#### Partial-match semantics (`matchesPartial`)

`partial` is compared against `entry.data` with **subset-equality**:

- **Fast path:** `Object.is(actual, partial)` (identical primitives/references, `null`, `NaN`).
- **Primitives** compare via `Object.is` — so `NaN` matches `NaN`, and `+0`/`-0` are distinguished.
- **Plain objects:** every key in `partial` must be present on `actual` and recursively match; extra `actual` keys are ignored.
- **Arrays:** matched **element-wise** — lengths must be equal and each index pair recursively matches.
- **Type guards:** an object `partial` against `null` or a non-object `actual` is no match; an array `partial` against a non-array `actual` is no match.

## Configuration

`pluginConfigs.log` — all fields optional (a default is supplied).

| Field | Type | Default | Notes |
|---|---|---|---|
| `mode` | `"test" \| "dev" \| "production" \| "silent"` | `"production"` | Sink-selection mode. The in-memory trace is on in **every** mode; this field only chooses whether (and at what threshold) a console sink is installed at `onInit`. |

`mode` resolves via the 4-level core-plugin cascade: spec default (`"production"`) → `createCoreConfig` → `createCore` → `createApp`. The framework's `createCoreConfig` pins the level-2 default to `log: { mode: "production" }`; consumers and tests override it through `createApp({ pluginConfigs: { log: { mode: ... } } })` (e.g. `"test"` or `"silent"` to silence console output). There is **no automatic mapping** from the global `Config.mode` (`"ssg" | "spa" | "hybrid"`) or `Config.stage` onto `log.mode`.

### Mode → default sinks

The in-memory trace (`state.entries`) is **always on**, regardless of mode. The console sink is installed at `onInit` only for `dev` and `production`, and at different thresholds:

| Mode | Console sink | Min level printed | In-memory trace |
|---|---|---|---|
| `test` | — | — | always on |
| `silent` | — | — | always on |
| `dev` | yes | `debug` (prints everything) | always on |
| `production` | yes | `info` (drops `debug`) | always on |

`production` suppresses `debug` so per-phase `debug` events don't spam a prod build, while `dev` prints everything. Either way, all levels are still recorded in the trace.

The console sink routes by channel: `error` → `console.error`, `warn` → `console.warn`, `debug`/`info` → `console.log`. The full entry object is forwarded so the console serializes its `event` and `data`. New sinks (file/JSON) can be added later via `addSink` / the `LogSink` interface without any API change.

## Design notes

- **Core plugin, no extra surface.** `createCorePlugin("log", …)` — no `depends`, `events`, or `hooks`; context is `{ config, state }`. `onInit` installs the mode-selected default sinks (synchronous); no `onStart` / `onStop` because `log` manages no external resource.
- **State isolation.** `createLogState()` returns a fresh `{ entries: [], sinks: [] }` per construction — no module-level singletons. Two `createApp` calls never share entries or sinks, which guarantees Vitest worker isolation.
- **Zero external dependencies.** The runtime touches only `console`, `Date.now`, and `JSON` — nothing platform-specific, so it runs unchanged on Node and in the browser.
- **The `LogSink` seam.** A sink is just `{ write(entry): void }`. The in-memory trace is itself the always-on backing store (`state.entries`); the console sink is the only built-in output. File/JSON sinks slot in via `addSink` with no change to the public API.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Plugin wiring — `createCorePlugin("log", { config, createState, api, onInit })`; default config `{ mode: "production" }`. |
| `types.ts` | Type surface — `LogConfig`, `LogLevel`, `LogEntry`, `LogSink`, `ExpectChain`, `LogState`, `LogApi`. |
| `api.ts` | `createLogApi` — leveled loggers over a shared `append`, the frozen `trace()`, the live `expect()`, `addSink`, `reset`; plus the internal `mergeError` helper. |
| `expect.ts` | The assertion DSL — `createExpectChain`, the `matchesPartial` subset matcher, and the named `LogExpectAssertionError`. |
| `sinks.ts` | Output sinks — the built-in `consoleSink(minLevel)` and the `installDefaultSinks` onInit helper. |
| `state.ts` | `createLogState` — fresh `{ entries: [], sinks: [] }` per construction. |
| `__tests__/` | Colocated unit + integration tests. |

---

<sub>Part of <strong><a href="../../../README.md">@moku-labs/web</a></strong> — built on <a href="https://github.com/moku-labs/core">@moku-labs/core</a>.</sub>
