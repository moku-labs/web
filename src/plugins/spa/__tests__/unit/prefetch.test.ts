// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPrefetcher,
  loadWithPrefetch,
  type Prefetcher,
  type PrefetchOptions
} from "../../prefetch";

/** One `fetch` call, left pending until the test settles it. */
interface PendingFetch {
  path: string;
  signal: AbortSignal | undefined;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
}

let fetches: PendingFetch[] = [];
const live: Prefetcher[] = [];

/** A preloader that `afterEach` disposes, so no listener leaks into the next test. */
function make(options: Partial<PrefetchOptions> = {}): Prefetcher {
  const prefetcher = createPrefetcher({ mode: "intent", usesHtml: () => true, ...options });
  live.push(prefetcher);
  return prefetcher;
}

/** A 200 page. */
function ok(html: string): Response {
  return new Response(html, { status: 200 });
}

/** The element for `selector`; fails the test when it is missing. */
function el(selector: string): Element {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
}

/** Dispatch a press (`pointerdown` by default) on the element. */
function press(selector: string, type = "pointerdown"): void {
  el(selector).dispatchEvent(new Event(type, { bubbles: true }));
}

/** Move the mouse onto the element. */
function hover(selector: string): void {
  el(selector).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
}

/** Move the mouse off the element, into `relatedTarget` (or nowhere). */
function leave(selector: string, relatedTarget?: Element): void {
  const init = relatedTarget ? { bubbles: true, relatedTarget } : { bubbles: true };
  el(selector).dispatchEvent(new MouseEvent("mouseout", init));
}

/** Run timers due now and the microtasks they queue. */
async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Set `navigator.connection` for the next preload start. */
function connection(value: { saveData?: boolean; effectiveType?: string }): void {
  Object.defineProperty(navigator, "connection", { value, configurable: true });
}

/** Every IntersectionObserver the preloader built (emptied before each test). */
const observers: FakeObserver[] = [];

/** A stand-in IntersectionObserver the test drives by hand. */
class FakeObserver {
  readonly observed = new Set<Element>();
  readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  /** Report the targets as intersecting the viewport. */
  enter(...targets: Element[]): void {
    this.report(targets, true);
  }

  /** Report the targets as outside the viewport (the first report for an off-screen link). */
  offScreen(...targets: Element[]): void {
    this.report(targets, false);
  }

  report(targets: Element[], isIntersecting: boolean): void {
    const entries = targets.map(target => ({ target, isIntersecting }));
    this.callback(
      entries as unknown as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver
    );
  }
}

/** The observer the preloader built; fails the test when none was built. */
function observer(): FakeObserver {
  const last = observers.at(-1);
  if (!last) throw new Error("no IntersectionObserver was built");
  return last;
}

/** `requestIdleCallback` that keeps the callbacks for the test to run. */
function stubIdle(): Array<() => void> {
  const callbacks: Array<() => void> = [];
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => callbacks.push(callback));
  vi.stubGlobal("cancelIdleCallback", vi.fn());
  return callbacks;
}

beforeEach(() => {
  vi.useFakeTimers();
  fetches = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const { promise, resolve, reject } = Promise.withResolvers<Response>();
      fetches.push({ path, signal: init?.signal ?? undefined, resolve, reject });
      return promise;
    })
  );
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  document.body.innerHTML = `<a id="a" href="/a/">a</a><a id="b" href="/b/">b</a><a id="c" href="/c/">c</a>`;
});

afterEach(() => {
  for (const prefetcher of live.splice(0)) prefetcher.dispose();
  Reflect.deleteProperty(navigator, "connection");
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("take: one use, 30 s, 20 entries", () => {
  // Bug: an old page is served again on every later visit.
  it("returns a settled preload once; the second take misses", async () => {
    const prefetcher = make();
    press("#a");
    fetches[0]?.resolve(ok("<p>a</p>"));
    await flush();

    expect(await prefetcher.take("/a/")).toBe("<p>a</p>");
    expect(prefetcher.take("/a/")).toBeUndefined();
  });

  // Bug: stale HTML is swapped in after a long idle.
  it("an entry is a hit at 30 s and a miss after 30 s", () => {
    let clock = 0;
    const prefetcher = make({ now: () => clock });
    press("#a");
    press("#b");

    clock = 30_000;
    expect(prefetcher.take("/a/")).toBeDefined();
    clock = 30_001;
    expect(prefetcher.take("/b/")).toBeUndefined();
  });

  // Bug: memory grows without bound on a long session.
  it("the 21st entry aborts and evicts the oldest", () => {
    document.body.innerHTML = Array.from(
      { length: 21 },
      (_, index) => `<a id="l${index}" href="/l${index}/">${index}</a>`
    ).join("");
    const prefetcher = make();
    for (let index = 0; index < 21; index++) press(`#l${index}`);

    expect(fetches).toHaveLength(21);
    expect(fetches[0]?.signal?.aborted).toBe(true);
    expect(fetches[1]?.signal?.aborted).toBe(false);
    expect(prefetcher.take("/l0/")).toBeUndefined();
    expect(prefetcher.take("/l1/")).toBeDefined();
  });

  // Bug: expired preloads keep their slot and their request alive.
  it("a new entry first drops and aborts the expired ones", () => {
    document.body.innerHTML += `<a id="d" href="/d/">d</a>`;
    let clock = 0;
    const prefetcher = make({ now: () => clock });
    press("#a");
    press("#b");
    clock = 10_000;
    press("#c");
    clock = 31_000;
    press("#d");

    expect(fetches.map(call => call.signal?.aborted)).toEqual([true, true, false, false]);
    expect(prefetcher.take("/c/")).toBeDefined();
    expect(prefetcher.take("/d/")).toBeDefined();
  });

  // Bug: a failed old preload removes the fresh preload of the same page.
  it("a replaced preload that fails later leaves the new one in place", async () => {
    let clock = 0;
    const prefetcher = make({ now: () => clock });
    press("#a");
    clock = 31_000;
    press("#a");
    expect(fetches).toHaveLength(2);

    fetches[0]?.reject(new DOMException("The operation was aborted.", "AbortError"));
    await flush();
    expect(prefetcher.take("/a/")).toBeDefined();
  });
});

describe("loadWithPrefetch", () => {
  // Bug: a cached error page is swapped in, or a failed preload ends in a full reload.
  it("a preload answering 500 is dropped; the navigation then fetches once with its signal", async () => {
    const prefetcher = make();
    press("#a");
    fetches[0]?.resolve(new Response("error page", { status: 500 }));
    await flush();
    expect(prefetcher.take("/a/")).toBeUndefined();

    const navigation = new AbortController();
    const loading = loadWithPrefetch(prefetcher, "/a/", navigation.signal);
    await flush();
    expect(fetches).toHaveLength(2);
    expect(fetches[1]?.signal).toBe(navigation.signal);
    fetches[1]?.resolve(ok("<p>a</p>"));
    expect(await loading).toBe("<p>a</p>");
  });

  // Bug: a navigation hangs or reloads when the preload it waits for dies.
  it("a preload failing while a navigation awaits it falls back to one real fetch", async () => {
    const prefetcher = make();
    press("#a");
    const loading = loadWithPrefetch(prefetcher, "/a/", new AbortController().signal);
    fetches[0]?.reject(new TypeError("network"));
    await flush();

    expect(fetches).toHaveLength(2);
    fetches[1]?.resolve(ok("<p>a</p>"));
    expect(await loading).toBe("<p>a</p>");
  });

  // Bug: a superseded navigation cancels or poisons the shared preload.
  it("a navigation aborted while awaiting a preload neither aborts it nor stores anything", async () => {
    const prefetcher = make();
    press("#a");
    const navigation = new AbortController();
    const loading = loadWithPrefetch(prefetcher, "/a/", navigation.signal);
    navigation.abort();

    expect(fetches[0]?.signal?.aborted).toBe(false);
    fetches[0]?.resolve(ok("<p>a</p>"));
    await loading;
    expect(prefetcher.take("/a/")).toBeUndefined();
    expect(fetches).toHaveLength(1);
  });

  // Bug: a dead navigation starts a fresh request after its preload failed.
  it("a superseded navigation whose preload fails starts no fetch", async () => {
    const prefetcher = make();
    press("#a");
    const navigation = new AbortController();
    const loading = loadWithPrefetch(prefetcher, "/a/", navigation.signal);
    navigation.abort();
    fetches[0]?.reject(new TypeError("network"));
    const settled = expect(loading).rejects.toMatchObject({ name: "AbortError" });
    await flush();

    expect(fetches).toHaveLength(1);
    await settled;
  });
});

describe("intent triggers", () => {
  // Bug: one link is fetched twice.
  it("pointerdown starts one fetch at once; a second pointerdown starts none", () => {
    make();
    press("#a");
    expect(fetches.map(call => call.path)).toEqual(["/a/"]);
    press("#a");
    expect(fetches).toHaveLength(1);
  });

  // Bug: a touch-only browser never preloads.
  it("touchstart starts the fetch at once", () => {
    make();
    press("#a", "touchstart");
    expect(fetches.map(call => call.path)).toEqual(["/a/"]);
  });

  // Bug: every link the mouse crosses is preloaded.
  it("a 40 ms hover then mouseout starts nothing; a 65 ms hover starts one fetch", async () => {
    make();
    hover("#a");
    await flush(40);
    leave("#a", document.body);
    await flush(100);
    expect(fetches).toHaveLength(0);

    hover("#a");
    await flush(64);
    expect(fetches).toHaveLength(0);
    await flush(1);
    expect(fetches.map(call => call.path)).toEqual(["/a/"]);
  });

  // Bug: a link with an icon or a span inside never preloads on hover.
  it("mouseout into a child of the same link keeps the hover timer", async () => {
    document.body.innerHTML = `<a id="a" href="/a/"><span id="icon">*</span> a</a>`;
    make();
    hover("#a");
    await flush(30);
    leave("#a", el("#icon"));
    await flush(35);
    expect(fetches.map(call => call.path)).toEqual(["/a/"]);
  });
});

describe("eligibility", () => {
  // Bug: the preload rules drift from the click interceptor's rules.
  it("no fetch for _blank, cross-origin, .pdf, download or the current page", () => {
    document.body.innerHTML = [
      `<a id="blank" href="/x/" target="_blank">x</a>`,
      `<a id="external" href="https://other.example/x/">x</a>`,
      `<a id="pdf" href="/file.pdf">x</a>`,
      `<a id="download" href="/y/" download>x</a>`,
      `<a id="current" href="${location.pathname}${location.search}">x</a>`,
      `<a id="a" href="/a/">a</a>`
    ].join("");
    make();
    for (const id of ["blank", "external", "pdf", "download", "current"]) press(`#${id}`);
    expect(fetches).toHaveLength(0);

    press("#a");
    expect(fetches).toHaveLength(1);
  });

  // Bug: a data-saver user's bandwidth is spent on preloads.
  it("no fetch with save-data on or on 2g / slow-2g; 4g preloads", () => {
    make();
    for (const value of [
      { saveData: true },
      { effectiveType: "2g" },
      { effectiveType: "slow-2g" }
    ]) {
      connection(value);
      press("#a");
    }
    expect(fetches).toHaveLength(0);

    connection({ effectiveType: "4g" });
    press("#a");
    expect(fetches).toHaveLength(1);
  });

  // Bug: HTML is fetched for a route the DATA path renders.
  it("no fetch when usesHtml is false", () => {
    make({ usesHtml: path => path !== "/b/" });
    press("#b");
    expect(fetches).toHaveLength(0);
    press("#a");
    expect(fetches).toHaveLength(1);
  });
});

describe("visible", () => {
  // Bug: a burst of requests on a gallery page, or visible mode stuck after two failed preloads.
  it("links in view load two at a time; a settled or a failed one frees its slot", async () => {
    document.body.innerHTML += `<a id="d" href="/d/">d</a>`;
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => setTimeout(callback, 0));
    const prefetcher = make({ mode: "visible" });
    prefetcher.observe();
    observer().enter(el("#a"), el("#b"), el("#c"), el("#d"));
    await flush();
    expect(fetches.map(call => call.path)).toEqual(["/a/", "/b/"]);

    fetches[0]?.resolve(ok("<p>a</p>"));
    await flush();
    expect(fetches.map(call => call.path)).toEqual(["/a/", "/b/", "/c/"]);

    fetches[1]?.reject(new TypeError("network"));
    await flush();
    expect(fetches.map(call => call.path)).toEqual(["/a/", "/b/", "/c/", "/d/"]);
  });

  // Bug: visible mode preloads every link of the page, or one link each time it scrolls past.
  it("only a link on screen is preloaded, and it is not watched again", async () => {
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => setTimeout(callback, 0));
    const prefetcher = make({ mode: "visible" });
    prefetcher.observe();
    const link = el("#a");
    observer().offScreen(link);
    await flush();
    expect(fetches).toHaveLength(0);
    expect(observer().observed.has(link)).toBe(true);

    observer().enter(link);
    await flush();
    expect(fetches.map(call => call.path)).toEqual(["/a/"]);
    expect(observer().observed.has(link)).toBe(false);
  });

  // Bug: visible preloads compete with the page's own work instead of waiting for idle time.
  it("the queue drains in an idle callback when requestIdleCallback exists", async () => {
    const idle = stubIdle();
    const prefetcher = make({ mode: "visible" });
    prefetcher.observe();
    observer().enter(el("#a"));
    await flush(1000);
    expect(fetches).toHaveLength(0);

    for (const callback of idle.splice(0)) callback();
    expect(fetches.map(call => call.path)).toEqual(["/a/"]);
  });

  // Bug: visible mode is dead in a browser without requestIdleCallback (Safari).
  it("without requestIdleCallback the queue drains after 200 ms", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    const prefetcher = make({ mode: "visible" });
    prefetcher.observe();
    observer().enter(el("#a"));
    await flush(199);
    expect(fetches).toHaveLength(0);
    await flush(1);
    expect(fetches.map(call => call.path)).toEqual(["/a/"]);
  });

  // Bug: an old browser without IntersectionObserver crashes on boot.
  it("without IntersectionObserver it still preloads on pointerdown", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const prefetcher = make({ mode: "visible" });
    expect(() => prefetcher.observe()).not.toThrow();
    press("#a");
    expect(fetches).toHaveLength(1);
  });

  // Bug: visible mode is dead after the first navigation.
  it("observe() after a swap watches the new page's links and forgets the old ones", async () => {
    const idle = stubIdle();
    const prefetcher = make({ mode: "visible" });
    prefetcher.observe();
    const old = el("#a");
    observer().enter(old);

    document.body.innerHTML = `<a id="next" href="/next/">next</a>`;
    prefetcher.observe();
    expect([...observer().observed]).toEqual([el("#next")]);

    // The old page's queued link is not preloaded on the new page.
    for (const callback of idle.splice(0)) callback();
    await flush();
    expect(fetches).toHaveLength(0);
  });

  // Bug: intent mode preloads every link on screen.
  it("intent mode never watches links", () => {
    make({ mode: "intent" }).observe();
    expect(observers).toHaveLength(0);
  });
});

describe("dispose", () => {
  // Bug: listeners, timers and requests outlive app.stop().
  it("aborts preloads, cancels hover and idle work, disconnects, and stops listening", async () => {
    const idle = stubIdle();
    const prefetcher = make({ mode: "visible" });
    prefetcher.observe();
    observer().enter(el("#c"));
    press("#a");
    hover("#b");

    prefetcher.dispose();
    for (const callback of idle.splice(0)) callback();
    await flush(100);
    press("#a");

    expect(fetches.map(call => call.path)).toEqual(["/a/"]);
    expect(fetches[0]?.signal?.aborted).toBe(true);
    expect(observer().observed.size).toBe(0);
    expect(prefetcher.take("/a/")).toBeUndefined();
    expect(() => prefetcher.dispose()).not.toThrow();
  });
});
