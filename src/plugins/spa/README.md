# spa

> **Isomorphic default** — the client runtime: island hydration, intercepted navigation, document-head sync, and a progress bar (inert on Node).

`spa` layers progressive client-side navigation over the static site. It intercepts in-app links, swaps a single page region without a full reload, syncs the document `<head>`, drives an in-house top progress bar, and manages component (island) lifecycles. It is a default plugin — mounted automatically at **`app.spa`** by `createApp`, so consumers reach its registration/control surface (`register`/`navigate`/`current`) without importing `spaPlugin`. Internally it depends on [`router`](../router/README.md) and [`head`](../head/README.md) (resolved via `ctx.require` in `onInit`) and optionally captures the [`data`](../data/README.md) reader by name to enable client DATA rendering. It emits four notification-only events (`spa:navigate`, `spa:navigated`, `spa:component-mount`, `spa:component-unmount`) and listens to nothing.

`spa` is the **one plugin that genuinely owns a browser resource**, so it is the only default that needs `onStart`/`onStop`: `onStart` boots navigation listeners + scroll restoration + island mounting; `onStop` tears them down. Because `onStart` is a no-op when `typeof document === "undefined"`, the plugin is inert in the Node SSG/build pipeline and boots only in a browser — the isomorphic guarantee. The single most important design decision is the **pure `createSpaKernel` factory**: built once in `onInit` and stored on `ctx.state.kernel`, it closes over injected state/config/emit/deps only (never the Moku ctx, never module singletons), so it is unit-testable with a mock state and a spy emit. `index.ts` is wiring only (≤30 lines) — all logic lives in the domain files.

> [!TIP]
> To ship the client runtime, import `createApp` + `createComponent` from the node-free `@moku-labs/web/browser` entry rather than the full `.` entry. `./browser`'s static import graph references zero node-only modules, so it can never drag native code into a client bundle (a stronger guarantee than tree-shaking the `.` entry), and it pre-wires `browserEnv()` so env works with zero config.

## Example
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

## API

The surface mounted at `app.spa` is the **registration / control** side. The DOM-bound runtime (navigation interception, island mounting) boots from `onStart`; every method delegates to the single shared kernel in `ctx.state.kernel`, so all are no-ops before boot or without a DOM.

| Method | Signature | Notes |
|---|---|---|
| `register` | `(component: ComponentDef) => void` | Register a component (keyed by name, last-registered-wins). A duplicate name logs a `spa:component-collision` warning via `ctx.log.warn` before overwriting. |
| `navigate` | `(path: string) => void` | Programmatically navigate (pathname, optionally with search/hash). Delegates to the kernel's `processNav`; no-op without a DOM or before boot. |
| `current` | `() => string` | Read the current resolved URL (`pathname + search`). Returns a copy of `ctx.state.currentUrl`; no raw state is exposed. |

### Exported helper: `createComponent(name, hooks)`

`createComponent(name: string, hooks: ComponentHooks): ComponentDef` is exported from both the `.` and `./browser` entries (and re-exported here from `index.ts`). It builds a validated component definition fail-fast at registration: an empty `name`, an unknown hook key (e.g. `onMout`, checked against `COMPONENT_HOOK_NAMES`), or a non-function hook value throws an actionable `[web] …` error immediately. Pass the result to `app.spa.register(...)` or to `pluginConfigs.spa.components`.

### Exported island: `lazyEmbed`

The companion of the content pipeline's `::embed` directive (see the content plugin's "Lazy iframe embeds"): a ready-made component, exported from both entries, that mounts on the emitted `[data-component="lazy-embed"]` facades and swaps them for a real `<iframe loading="lazy">` on click. Add it to `pluginConfigs.spa.components` (or `app.spa.register(lazyEmbed)`); style the `.lazy-embed*` classes yourself.

### Navigation: HTML-over-fetch, or client DATA render

Every navigation entry point (Navigation API, History fallback, `navigate()`) funnels through one strategy in the kernel:

1. **Client DATA path** — *only* when `router.mode() !== "ssg"` and the optional [`data`](../data/README.md) plugin is composed. `spa` runs `router.match(path)` → `data.at(path)` (fetch the page's PERSISTED JSON as `unknown`, used DIRECTLY as `ctx.data` — there is NO validation step) → the matched route's OWN `render(ctx)` (the SAME component the build used for SSG) → Preact-render into the swap region, then re-mounts islands. `route.load` does NOT run on the client. The Preact `render` layer is lazy-loaded (`./render`) in its own chunk, so an app without `data` ships zero render layer. The route's `.layout()` is intentionally NOT re-applied — the chrome (TopBar/TabNav/Footer) is persistent SSG output; only the inner swap region is replaced.
2. **HTML-over-fetch** (the default + fallback) — fetch the page, swap `swapSelector`, head-sync from the fetched `<head>`. Any DATA-path miss / non-JSON / throw falls back here.
3. **`location.href`** — a failed fetch falls back to a full browser navigation.

**Client-only routes (spa mode).** In `mode: "spa"` a dynamic route with no `.generate()` (the [`router`](../router/README.md)'s `isClientOnlyRoute`) is **not** pre-rendered by the build — its concrete param paths are unknown at build time, so emitting a static shell would only write a file at the wrong path. The client renders it from the URL with `ctx.data = {}` (its islands fetch whatever they need), so the DATA path runs for it with **neither the `data` plugin nor a sidecar**. This also covers initial load: `boot()` client-renders the matched client-only route into the swap region, so a deep-link / refresh paints the right page (the host serves any SPA-fallback shell for the unmatched path; pre-rendered routes are hydrated from their own served HTML as before).

`spa` stays `depends: [router, head]` and imports neither `data` nor its types — it captures the `data` reader at init via a structural by-name `ctx.require` (only when `ctx.has("data")`) and drives the matched route's handlers structurally.

## Configuration

`pluginConfigs.spa` — all fields optional; defaults are applied and validated in `onInit`.

| Field | Type | Default | Notes |
|---|---|---|---|
| `swapSelector` | `string` | `"main > section"` | CSS selector for the DOM region replaced on each navigation. |
| `viewTransitions` | `boolean` | `false` | Opt-in `document.startViewTransition` wrapping; instant swap when unsupported or under `prefers-reduced-motion`. |
| `progressBar` | `boolean` | `true` | Toggle the in-house top progress bar shown during navigation. |
| `components` | `ComponentDef[]` | `[]` | Components to auto-register at init (in addition to runtime `register`). |

**Validation (`onInit`, Part-3 errors):**

- `swapSelector` must be a non-empty string and a syntactically valid CSS selector — otherwise an actionable `[web] spa.swapSelector …` error is thrown.
- `components` entries must each pass `createComponent` validation (every hook key in `COMPONENT_HOOK_NAMES`; every hook value a function).

## Dependencies

`depends: [routerPlugin, headPlugin]` — resolved via `ctx.require` in `onInit` and reused by the kernel:

| Plugin | Pulled via | Used for |
|---|---|---|
| [`router`](../router/README.md) | `ctx.require(routerPlugin)` | Client-side route matching (`match`), the resolved global `mode()`, and `toUrl` link building. |
| [`head`](../head/README.md) | `ctx.require(headPlugin)` | Binds the structural dependency for client head-sync; the composed head is re-applied from the fetched document (never re-composed). |
| [`data`](../data/README.md) *(optional)* | `ctx.require(dataPlugin)`, guarded by `ctx.has("data")` | Enables the client DATA path; the reader's `at(path)` is bound as `deps.dataAt`. Absent → HTML-over-fetch only. |

## Events

`spa` emits four registered, notification-only events and listens to nothing. (Elsewhere in the framework `progress`-style consumers and `head`/analytics listen to these — those are *their* registrations, not spa's.)

| Event | Payload | When |
|---|---|---|
| `spa:navigate` | `{ from: string; to: string }` | A navigation has been intercepted and is starting. |
| `spa:navigated` | `{ url: string }` | The swap completed and the new URL is active. |
| `spa:component-mount` | `{ name: string; el: Element }` | A component instance attached to an element. |
| `spa:component-unmount` | `{ name: string; el: Element }` | A component instance detached from an element. |

## Design notes

### Component lifecycle

A component is a `{ name, hooks }` definition (`ComponentDef`) created via `createComponent` and matched at mount time against the `data-component` attribute of elements inside the swap region. Each mounted element gets a `ComponentInstance`; every hook receives a `ComponentContext` (`{ el, data }`, where `data` is the page payload parsed from the inline `script#__DATA__`, or `{}` when absent/invalid).

Instances are classified as **persistent** (outside the swap area — survive navigation, receive `onNavStart`/`onNavEnd`, never `onUnMount` on nav) or **page-specific** (inside the swap area — full unmount/destroy/create/mount cycle on every navigation).

| Hook | When |
|---|---|
| `onCreate` | Once when the instance is created (before DOM attach). |
| `onMount` | After the instance is attached to its element. |
| `onNavStart` | A navigation begins while this instance is mounted. |
| `onNavEnd` | A navigation completes while this instance is mounted. |
| `onUnMount` | Before the instance is detached from its element. |
| `onDestroy` | Once when the instance is destroyed (after detach). |

Hook order on a page-specific swap is `onCreate → onMount` on mount, then `onUnMount → onDestroy` on teardown; persistent instances see `onNavStart` at nav begin and `onNavEnd` at nav complete. On `dispose` (plugin stop) ALL instances run `onUnMount → onDestroy`. Prefer **data-attributes over CSS classes** to reflect state in the DOM:

```ts
import { createComponent } from "@moku-labs/web";

const article = createComponent("article", {
  onCreate({ el }) { el.dataset.ready = ""; },
  onNavStart({ el }) { el.dataset.loading = ""; },   // marks an in-flight navigation
  onNavEnd({ el }) { delete el.dataset.loading; },
  onUnMount({ el }) { el.replaceChildren(); },
  onDestroy({ el }) { delete el.dataset.ready; }
});
```

### Lifecycle and teardown

`onInit` builds the single shared kernel, validates config, registers `config.components`, and seeds `currentUrl` from the document location (or `""` under SSR). `onStart` captures the kernel teardown + a `log` reference, then boots the browser runtime (router listeners + initial scan); a double-boot throws.

Per spec/08 §4, `onStop` receives **`{ global }` only** — no `state`, `log`, `emit`, or `require`. The handles it needs are therefore captured into factory-closure variables during `onStart`, then run inside `try/catch/finally` and cleared after (idempotent; mirrors `onStart`).

> [!NOTE]
> **Single app per process.** Because the teardown/log handles live in module scope, running two apps in one process would share them. This is the spec-sanctioned pattern for resource-managing plugins; all *kernel data* (`registeredComponents`, `instances`, `currentUrl`, …) still lives in `createState`, never module scope.

### Navigation interception

`attachRouter` prefers the **Navigation API** when supported, falling back to a **History API** click/popstate path otherwise. Internal-link classification skips modifier-key clicks, `target="_blank"`, cross-origin URLs, and static assets (`.xml`/`.json`/images/fonts/PDF). Scroll position is saved per path in `sessionStorage` (best-effort) and restored on back/forward.

### Head-sync and progress bar

Head-sync re-applies the composed `<head>` from the fetched document — title, `<html lang>`, a fixed set of single-element meta/canonical selectors (replace/append/remove), and full-replace groups (JSON-LD, `hreflang` alternates, `article:*`). It is a faithful re-application of `head`'s build-time composition, not a second implementation. The progress bar is an in-house NProgress-style `<div data-progress>` (no `nprogress` dependency): a 150 ms start delay (so fast navs show nothing), trickle to a 90% ceiling, complete to 100% then linger 200 ms. It is a no-op shell when disabled or headless.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Wiring only (≤30 lines): `depends`, config/state/events, `onInit`/`onStart`/`onStop`, re-exports `createComponent`. |
| `kernel.ts` | The pure `createSpaKernel` factory + `initSpa` onInit helper (navigation strategy, DATA path, swap orchestration). |
| `router.ts` | Navigation interception (Navigation API + History fallback), link classification, scroll save/restore, `performNavigation`/`runSwap`/`swapRegion`. |
| `components.ts` | `createComponent`, instance mount/unmount, hook dispatch, `script#__DATA__` extraction. |
| `head.ts` | Client head-sync over `head`'s composition (`syncHead`). |
| `progress.ts` | In-house top progress bar (`createProgressBar`). |
| `render.ts` | Lazy-loaded Preact render layer (`renderVNode`) — its own chunk, reached only on the DATA path. |
| `lifecycle.ts` | `onStop` closure capture/dispose (`captureTeardown`/`disposeSpa`). |
| `state.ts` | `createState`, `defaultSpaConfig`, `resolveSpaConfig` (validation). |
| `api.ts` | `createApi` — the `register`/`navigate`/`current` surface. |
| `events.ts` | Event descriptor registration (`spaEvents`). |
| `types.ts` | Config/state/API/component/kernel type definitions. |

---

<sub>Part of <strong><a href="../../../README.md">@moku-labs/web</a></strong> — built on <a href="https://github.com/moku-labs/core">@moku-labs/core</a>.</sub>
