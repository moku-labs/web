# spa

> Complex plugin — the client-side SPA runtime: intercepts in-app navigation, swaps the page region without a full reload, syncs the document head, drives a progress bar, and manages component lifecycles.

`spa` depends on `router` and `head`, resolving both via `ctx.require(...)` in `onInit`.
It is the **one plugin that genuinely needs `onStart`/`onStop`** — it boots a browser
runtime (navigation listeners, scroll restoration, mounted component instances) that must
be torn down on stop. The heart of the plugin is a single **pure `createSpaKernel`** factory
built once in `onInit` and stored in `ctx.state.kernel`; `api`, `onStart`, and `onStop` all
reuse that one instance. `index.ts` is wiring only (≤30 lines) — all logic lives in the
domain files (`kernel`, `router`, `head`, `progress`, `components`, `lifecycle`).

`spa` is an **isomorphic framework default**: `onStart` is a no-op when
`typeof document === "undefined"`, so it is inert in the Node SSG/build pipeline and boots the
browser runtime only in a browser. To ship `spa`'s client runtime, import `createApp` +
`spaPlugin` from the dedicated browser-safe entry **`@moku-labs/web/browser`** rather than the
full `.` entry. `./browser` is ESM-only, exports the same `createApp`/`createPlugin` over the
same isomorphic default set (`site`, `i18n`, `router`, `head`, `spa` + the `log`/`env` core)
plus `dataPlugin`, `defineRoutes`, `route`, `createComponent`, `browserEnv`, the SEO head primitives, and the
browser-relevant type namespaces, while **excluding** everything node-only (`contentPlugin`,
`buildPlugin`, `deployPlugin`, the `dotenv`/`processEnv`/`cloudflareBindings` env providers, and
the `Build`/`Content`/`Deploy` type namespaces). Its static import graph references zero
node-only modules, so importing `@moku-labs/web/browser` can **never** drag node/native code into
a client bundle regardless of bundler or tree-shaking — a stronger, more reliable guarantee than
importing `@moku-labs/web` and relying on `sideEffects: false` tree-shaking (which is fragile,
since building entries together can merge node code into a shared chunk). A CI gate
(`bun run check:bundle`) asserts the built browser bundle has zero static node/native imports and
stays under a gzip size budget (the browser bundle is ~35 kB gzip). `./browser` also **pre-wires
`browserEnv()` as the default env provider**, so env works with zero consumer config (resolving
from `import.meta.env` and `globalThis.__ENV__`) — you do not need to pass
`pluginConfigs.env.providers`. A browser app is just your own `createApp(...).start()` over the
defaults; `spa`'s `onStart` boots navigation listeners and mounts islands onto the SSR'd DOM.
Use the `.` entry for the Node SSG build (adding `contentPlugin`/`buildPlugin`/`deployPlugin` and
wiring `dotenv`/`processEnv`); use `./browser` for the client/browser bundle.

## API

The public surface mounted at `app.spa` is the **registration / control** side
(`register`/`navigate`/`current`). The DOM-bound runtime (navigation interception, island
mounting) boots from `onStart`; all methods delegate to the single shared kernel in
`ctx.state.kernel`.

### `register(component: ComponentDef): void`

Register a component definition for client mounting (keyed by name, last-registered-wins).
A duplicate name logs a `spa:component-collision` warning via `ctx.log.warn` before overwriting,
so config-then-runtime ordering stays predictable. Build component definitions with the
exported `createComponent(name, hooks)` factory (validates hook names fail-fast).

### `navigate(path: string): void`

Programmatically navigate to a path (pathname, optionally with search/hash). Delegates to the
kernel's `processNav` — a no-op without a DOM or before the runtime has booted.

### `current(): string`

Read the current resolved URL (`pathname + search`). Returns a string copy of
`ctx.state.currentUrl`; no raw state is exposed.

### Navigation: HTML-over-fetch, or client DATA render

Every navigation entry point (Navigation API, History fallback, `navigate()`) funnels
through one strategy:

1. **Client DATA path** — *only* when `router.mode() !== "ssg"` and the optional
   [`data`](../data/README.md) plugin is composed. `spa` runs `router.match(path)` →
   `data.at(path)` (fetch the page's PERSISTED data as `unknown`) → the route's own
   `parse(raw)` (validate → `D`) → `render(ctx)` (the SAME component the build used for
   SSG) → Preact-render into the swap region, then re-mounts islands. `route.load` does
   NOT run on the client. The Preact `render` layer is lazy-loaded (`./render`) in its own
   chunk, so an app without `data` ships zero render layer.
2. **HTML-over-fetch** (the default + fallback) — fetch the page, swap `swapSelector`,
   head-sync from the fetched `<head>`. Any DATA-path miss/throw falls back here.
3. **`location.href`** — a failed fetch falls back to a full browser navigation.

`spa` stays `depends: [router, head]` and imports neither `data` nor its types — it
captures the `data` reader at init via a structural by-name `ctx.require` (only when
`ctx.has("data")`) and drives the matched route's handlers structurally.

### Usage

```ts
// Browser bundle: import from the node-free "./browser" entry (env is pre-wired).
import { createApp, createComponent, defineRoutes, route } from "@moku-labs/web/browser";

const counter = createComponent("counter", {
  onMount({ el }) {
    el.textContent = "0";
    el.dataset.ready = "";
  },
  onDestroy({ el }) {
    delete el.dataset.ready;
  }
});

const app = createApp({
  pluginConfigs: {
    router: { routes: defineRoutes({ home: route("/").render(() => <Home />) }) },
    spa: { swapSelector: "main > section", components: [counter] }
  }
});

await app.start();          // boots the browser runtime (no-op under SSR/build)
app.spa.register(counter);  // also registerable at runtime
app.spa.navigate("/about"); // fetch → swap → head-sync → emit
app.spa.current();          // "/about"
```

## Configuration

The plugin contributes a `spa` config block. All fields are optional; defaults are applied and
validated in `onInit`.

| Field            | Type             | Default            | Description                                                                 |
| ---------------- | ---------------- | ------------------ | --------------------------------------------------------------------------- |
| `swapSelector`   | `string`         | `"main > section"` | CSS selector for the DOM region replaced on each navigation.                |
| `viewTransitions`| `boolean`        | `false`            | Opt-in `document.startViewTransition` wrapping; instant swap when unsupported. |
| `progressBar`    | `boolean`        | `true`             | Toggle the in-house top progress bar shown during navigation.               |
| `components`     | `ComponentDef[]` | `[]`               | Components to auto-register at init (in addition to runtime `register`).     |

**Validation (`onInit`, Part-3 errors):**

- `swapSelector` must be a non-empty string and a syntactically valid CSS selector — otherwise an
  actionable `[web] spa.swapSelector …` error is thrown.
- `components` entries must each pass `createComponent` validation (every hook key must be in
  `COMPONENT_HOOK_NAMES` and every hook value must be a function).

## Events

`spa` emits four registered, notification-only events and listens to nothing. (Per the framework
event catalog, `progress` listens to `spa:navigate` and `head`/`analytics` listen to
`spa:navigated` — those are *their* registrations, not spa's.)

| Event                   | Payload                          | When                                              |
| ----------------------- | -------------------------------- | ------------------------------------------------- |
| `spa:navigate`          | `{ from: string; to: string }`   | A navigation has been intercepted and is starting. |
| `spa:navigated`         | `{ url: string }`                | The swap completed and the new URL is active.     |
| `spa:component-mount`   | `{ name: string; el: Element }`  | A component instance attached to an element.      |
| `spa:component-unmount` | `{ name: string; el: Element }`  | A component instance detached from an element.    |

## Component lifecycle

A component is a `{ name, hooks }` definition (`ComponentDef`) created via `createComponent` and
matched at mount time against the `data-component` attribute of elements inside the swap region.
Each mounted element gets a `ComponentInstance`; every hook receives a `ComponentContext`
(`{ el, data }`, where `data` is the page payload parsed from the inline `script#__DATA__`).

Instances are classified as **persistent** (outside the swap area — survive navigation and
receive `onNavStart`/`onNavEnd`, never `onUnMount` on nav) or **page-specific** (inside the swap
area — full unmount/destroy/create/mount cycle on every navigation).

| Hook          | When                                                            |
| ------------- | -------------------------------------------------------------- |
| `onCreate`    | Once when the instance is created (before DOM attach).         |
| `onMount`     | After the instance is attached to its element.                 |
| `onNavStart`  | A navigation begins while this instance is mounted.            |
| `onNavEnd`    | A navigation completes while this instance is mounted.         |
| `onUnMount`   | Before the instance is detached from its element.              |
| `onDestroy`   | Once when the instance is destroyed (after detach).            |

Hook order on a page-specific swap is `onCreate → onMount` on mount, then `onUnMount → onDestroy`
on teardown; persistent instances see `onNavStart` at nav begin and `onNavEnd` at nav complete.
Prefer **data-attributes over CSS classes** to reflect state in the DOM:

```ts
import { createComponent } from "@moku-labs/web";

const article = createComponent("article", {
  onCreate({ el }) {
    el.dataset.ready = "";
  },
  onNavStart({ el }) {
    el.dataset.loading = ""; // marks an in-flight navigation
  },
  onNavEnd({ el }) {
    delete el.dataset.loading;
  },
  onUnMount({ el }) {
    el.replaceChildren();
  },
  onDestroy({ el }) {
    delete el.dataset.ready;
  }
});
```

`createComponent` validates hook names fail-fast at registration: an unknown key (e.g. `onMout`),
an empty name, or a non-function hook value throws a Part-3 error immediately.

## Lifecycle and teardown

`onInit` builds the single shared kernel (`createSpaKernel(state, config, emit, { router, head })`),
validates config, registers `config.components`, and seeds `currentUrl` from the document location
(or `""` under SSR). `onStart` captures the kernel teardown and boots the browser runtime (router
listeners + initial scan); a double-boot throws.

Per spec/08 §4, `onStop` receives **`{ global }` only** — no `state`, `log`, `emit`, or `require`.
The handles it needs (the kernel teardown and a `log` reference) are therefore captured into
module/factory-closure variables during `onStart`, then run inside `try/catch/finally` and nulled
after (idempotent; mirrors `onStart`). **Caveat — single app per process:** because those handles
live in module scope, running two apps in one process would share them. This is the spec-sanctioned
pattern for resource-managing plugins; all *kernel data* (`registeredComponents`, `instances`,
`currentUrl`, …) still lives in `createState`, never module scope.
