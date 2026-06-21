// @vitest-environment happy-dom
/**
 * @file Unit tests for `@moku-labs/web/testing` (the island test harness) — which
 * double as end-to-end coverage of the plugin-mirror component API: typed per-instance
 * state, the ctx.set → render scheduler, declarative delegated events + auto-teardown,
 * ctx.cleanup, the cross-island api seam, route/nav, and emit capture.
 */
import { h } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { createComponent } from "../../src/plugins/spa/components";
import { mountIsland, renderIsland } from "../../src/testing";

afterEach(() => {
  document.body.innerHTML = "";
});

type CounterState = { count: number; label: string };
type CounterApi = { bump: () => void };

/** A string-render island exercising state + render + events + api + async-ish onMount. */
function makeCounter() {
  return createComponent<CounterState, CounterApi>("counter", {
    state: () => ({ count: 0, label: "idle" }),
    onMount: ctx => ctx.set({ label: "ready" }),
    render: s =>
      `<button data-inc>+</button><output data-count>${s.count}</output><span data-label>${s.label}</span>`,
    events: { "click [data-inc]": ctx => ctx.set(prev => ({ count: prev.count + 1 })) },
    api: ctx => ({ bump: () => ctx.set(prev => ({ count: prev.count + 1 })) })
  });
}

describe("mountIsland — state, render & events", () => {
  it("exposes typed state, renders it, and updates on a delegated event", async () => {
    const handle = mountIsland<CounterState, CounterApi>(makeCounter());
    await handle.settle();

    expect(handle.state).toEqual({ count: 0, label: "ready" });
    expect(handle.el.querySelector("[data-count]")?.textContent).toBe("0");
    expect(handle.el.querySelector("[data-label]")?.textContent).toBe("ready");

    handle.fire("click [data-inc]");
    handle.flush();
    expect(handle.state?.count).toBe(1);
    expect(handle.el.querySelector("[data-count]")?.textContent).toBe("1");
  });

  it("exposes the island's registered api and re-renders on api-driven state change", async () => {
    const handle = mountIsland<CounterState, CounterApi>(makeCounter());
    await handle.settle();

    handle.api?.bump();
    handle.flush();
    expect(handle.state?.count).toBe(1);
    expect(handle.el.querySelector("[data-count]")?.textContent).toBe("1");
  });

  it("batches multiple ctx.set calls in one tick into a single render", async () => {
    let renders = 0;
    const counted = createComponent<{ n: number }, { add(): void }>("counted", {
      state: () => ({ n: 0 }),
      render: s => {
        renders += 1;
        return `<i>${s.n}</i>`;
      },
      api: ctx => ({ add: () => ctx.set(prev => ({ n: prev.n + 1 })) })
    });
    const handle = mountIsland<{ n: number }, { add(): void }>(counted);
    await handle.settle();
    const baseline = renders;

    handle.api?.add();
    handle.api?.add();
    handle.api?.add();
    await Promise.resolve(); // let the single scheduled microtask render run

    expect(handle.state?.n).toBe(3);
    expect(renders - baseline).toBe(1); // three sets coalesced into one render
  });

  it("commits a VNode render through the lazy Preact gate after settle()", async () => {
    const list = createComponent<{ items: string[] }>("vlist", {
      state: () => ({ items: [] }),
      onMount: ctx => ctx.set({ items: ["a", "b", "c"] }),
      render: s => h("ul", {}, ...s.items.map(item => h("li", { "data-item": "" }, item)))
    });
    const handle = mountIsland<{ items: string[] }>(list);
    await handle.settle();
    expect(handle.el.querySelectorAll("[data-item]")).toHaveLength(3);
  });
});

describe("mountIsland — teardown & cross-island api", () => {
  it("runs ctx.cleanup and removes delegated listeners on unmount", () => {
    let clicks = 0;
    let disposed = 0;
    const island = createComponent("teardown", {
      onMount: ctx => ctx.cleanup(() => (disposed += 1)),
      events: { "click [data-x]": () => (clicks += 1) }
    });
    const handle = mountIsland(island, { html: `<button data-x>x</button>` });

    handle.fire("click [data-x]");
    expect(clicks).toBe(1);

    handle.unmount();
    expect(disposed).toBe(1);

    handle.fire("click [data-x]");
    expect(clicks).toBe(1); // listener was removed on destroy
  });

  it("resolves a stubbed sibling api via ctx.component (options.components)", () => {
    let pong = "";
    const consumer = createComponent("consumer", {
      onMount: ctx => {
        pong = ctx.component<{ ping(): string }>("provider")?.ping() ?? "";
      }
    });
    mountIsland(consumer, { components: { provider: { ping: () => "pong" } } });
    expect(pong).toBe("pong");
  });

  it("registers the island's own api so it resolves by name", () => {
    const provider = createComponent<object, { ping(): string }>("provider", {
      api: () => ({ ping: () => "pong" })
    });
    const handle = mountIsland<object, { ping(): string }>(provider);
    expect(handle.api?.ping()).toBe("pong");
  });

  it("captures spa:component-mount / -unmount emits", () => {
    const handle = mountIsland(createComponent("plain", {}));
    expect(handle.emitted.map(entry => entry.event)).toContain("spa:component-mount");
    handle.unmount();
    expect(handle.emitted.map(entry => entry.event)).toContain("spa:component-unmount");
  });
});

describe("mountIsland — route & navigation", () => {
  it("passes the route slice and fires onNavEnd on a persistent island", () => {
    const seen: string[] = [];
    const nav = createComponent("nav", {
      onMount: ctx => seen.push(`mount:${ctx.locale}:${ctx.params.id ?? ""}`),
      onNavEnd: ctx => seen.push(`navend:${ctx.params.id ?? ""}`)
    });
    const handle = mountIsland(nav, { persistent: true, params: { id: "1" }, locale: "en" });

    handle.navEnd({ params: { id: "2" } });
    expect(seen).toEqual(["mount:en:1", "navend:2"]);
  });
});

describe("renderIsland — pure view tier", () => {
  it("renders a pure view from fixture state with no kernel", () => {
    const result = renderIsland<{ items: string[] }>(
      s => h("ul", {}, ...s.items.map(item => h("li", { "data-i": "" }, item))),
      { state: { items: ["x", "y", "z"] } }
    );
    expect(result.host.querySelectorAll("[data-i]")).toHaveLength(3);
    expect(result.html()).toContain("x");
    expect(result.find("[data-i]")).not.toBeNull();

    result.unmount();
    expect(result.host.isConnected).toBe(false);
  });
});
