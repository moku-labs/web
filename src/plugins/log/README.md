# log

> Standard core plugin — structured logging + an always-on in-memory trace with
> an `expect()` DSL for LLM- and test-verifiable workflow assertions. Injected
> flat onto every regular plugin context as `ctx.log` and surfaced as `app.log`.

This is a **Core Plugin** (`createCorePlugin`): no `depends`, `events`, or
`hooks`; its context is `{ config, state }` only. It runs its `onInit` before
every regular plugin, so logging is available throughout the lifecycle. It has
**zero external dependencies** (only `console`, `Date.now`, `JSON`).

## API

Injected as `ctx.log.<method>()` / `app.log.<method>()`.

| Method | Description |
| --- | --- |
| `info(event, data?)` | Append an `info` entry and fan out to every sink. |
| `debug(event, data?)` | Append a `debug` entry. |
| `warn(event, data?)` | Append a `warn` entry. |
| `error(event, data?, error?)` | Append an `error` entry; when `error` is supplied, its `message`/`stack` are merged into `data` under an `error` key (existing keys preserved; non-object `data` is coerced to `{}` first). |
| `trace()` | Return a **frozen snapshot** (fresh copy) of all entries recorded so far. |
| `expect()` | Return a fluent assertion chain bound to the **live** entries array. |
| `addSink(sink)` | Register an additional `LogSink` at runtime (the file/JSON seam). |
| `reset()` | Clear all recorded entries while **keeping** registered sinks. |

Each `LogEntry` is `{ level, event, data?, ts }` where `ts` is `Date.now()` at
append time. Entries are appended to the in-memory trace first, then written to
every registered sink in registration order.

### `trace()` vs `expect()`

- `trace()` returns a **frozen copy** — later log calls never retroactively
  appear in a previously returned snapshot, and the result cannot be mutated.
- `expect()` reads the **live** entries array on each assertion call — a chain
  created before more logging still sees the newer entries.

## The `expect()` DSL

The crown jewel: assert that a workflow behaved as expected. Every method
returns the same chain for fluent chaining; failures throw
`LogExpectAssertionError` with a descriptive message (event name, the
JSON-stringified `partial` when present, and the offending index for ordering /
negative cases).

```ts
app.log
  .expect()
  .toHaveEvent("build:phase", { phase: "content", status: "start" })
  .toHaveEventInOrder(["build:phase", "build:complete"])
  .toNotHaveEvent("deploy:failed");
```

- **`toHaveEvent(event, partial?)`** — at least one entry has `event`, optionally
  matching `partial` (subset match against `entry.data`).
- **`toHaveEventInOrder(events)`** — all `events` appear in the given relative
  order (gaps allowed); matched by **event name only**.
- **`toNotHaveEvent(event, partial?)`** — no entry has `event` (optionally
  narrowed by `partial`).

### Partial-match semantics (`matchesPartial`)

`partial` is compared against `entry.data` with **subset-equality**:

- Fast path: `Object.is(actual, partial)` (identical primitives/references,
  `null`, `NaN`).
- Primitives compare via `Object.is` (so `NaN` matches `NaN`; `+0`/`-0`
  distinguished).
- Plain objects: every key in `partial` must be present on `actual` and
  recursively match; extra `actual` keys are ignored.
- Arrays: matched **element-wise** — lengths must be equal and each index pair
  recursively matches.
- `null`/type guards: object `partial` against `null` / a non-object `actual`
  is no match; an array `partial` against a non-array `actual` is no match.

## Configuration

```ts
type LogConfig = {
  /** Sink-selection mode. Defaults to "production". */
  mode: "test" | "dev" | "production" | "silent";
};
```

Resolved via the 4-level core-plugin merge: spec default → `createCoreConfig`
→ `createCore` → `createApp`. The framework maps the global `Config.mode`
(`"production" | "development"`) onto `pluginConfigs.log.mode`
(`development` → `dev`); consumers/tests may override (e.g. `"test"`,
`"silent"`).

## Mode → default sinks

The in-memory trace (`state.entries`) is **always on**, regardless of mode. The
console sink is installed at `onInit` only for `dev` and `production`:

| Mode | Console sink | In-memory trace |
| --- | --- | --- |
| `test` | — | always on |
| `silent` | — | always on |
| `dev` | yes | always on |
| `production` | yes | always on |

The console sink routes by channel: `error` → `console.error`, `warn` →
`console.warn`, `debug`/`info` → `console.log`. New sinks (file/JSON) can be
added later via `addSink` / the `LogSink` interface without any API change.

## Lifecycle

- **`onInit`** — install mode-selected default sinks (synchronous).
- **No `onStart` / `onStop`** — `log` manages no external resource (only
  in-memory arrays and synchronous sinks), so per the framework convention these
  are intentionally omitted.

## State isolation

`createLogState()` returns a fresh `{ entries: [], sinks: [] }` per
construction — no module-level singletons. Two `createApp` calls never share
entries or sinks, guaranteeing Vitest worker isolation.
