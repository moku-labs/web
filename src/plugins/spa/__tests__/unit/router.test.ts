// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachHistoryFallback,
  attachNavigationApi,
  attachRouter,
  isInternalLink,
  performNavigation,
  type RouterHandlers,
  resolveClickTarget,
  restoreScrollPosition,
  runSwap,
  saveScrollPosition,
  swapRegion
} from "../../router";

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

/** A fake NavigateEvent that records intercept() registration. */
function fakeNavEvent(overrides: Record<string, unknown> = {}) {
  return {
    destination: { url: "http://localhost:3000/about" },
    canIntercept: true,
    hashChange: false,
    // eslint-disable-next-line unicorn/no-null -- mirrors the native NavigateEvent.downloadRequest shape
    downloadRequest: null,
    navigationType: "push",
    intercept: vi.fn(),
    scroll: vi.fn(),
    ...overrides
  };
}

/** Run the handler registered with the first `intercept(...)` call on a fake event. */
function runIntercept(event: { intercept: { mock: { calls: unknown[][] } } }): Promise<void> {
  const options = event.intercept.mock.calls.at(0)?.at(0) as { handler: () => Promise<void> };
  return options.handler();
}

/** Attach the Navigation API to a mock and return the registered navigate listener. */
function attachAndCapture(handlers: RouterHandlers): (e: unknown) => void {
  let captured: ((e: unknown) => void) | undefined;
  const navMock = {
    addEventListener: (_t: string, l: (e: unknown) => void) => {
      captured = l;
    },
    removeEventListener: vi.fn()
  };
  attachNavigationApi(navMock as never, handlers);
  return captured as (e: unknown) => void;
}

describe("isInternalLink", () => {
  it("accepts internal pages; rejects static assets and external origins", () => {
    expect(isInternalLink(new URL("/about", location.origin))).toBe(true);
    expect(isInternalLink(new URL("/data.json", location.origin))).toBe(false);
    expect(isInternalLink(new URL("https://other.example/x"))).toBe(false);
  });
});

describe("resolveClickTarget", () => {
  it("returns undefined for modifier-key clicks and new-tab links", () => {
    document.body.innerHTML = `<a href="/about" id="a">x</a>`;
    const anchor = document.querySelector("#a") as Element;
    expect(
      resolveClickTarget({ metaKey: true, target: anchor } as unknown as MouseEvent)
    ).toBeUndefined();
  });

  it("returns the internal URL for a plain anchor click", () => {
    document.body.innerHTML = `<a href="/about" id="a">x</a>`;
    const anchor = document.querySelector("#a") as Element;
    const url = resolveClickTarget({
      target: anchor,
      preventDefault() {}
    } as unknown as MouseEvent);
    expect(url?.pathname).toBe("/about");
  });
});

describe("scroll restoration", () => {
  it("saves and restores a prior scroll position; new nav resets to top", () => {
    Object.defineProperty(globalThis, "scrollY", { value: 250, configurable: true });
    saveScrollPosition("/list");
    expect(sessionStorage.getItem("spa:scroll:/list")).toBe("250");

    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    restoreScrollPosition("/list"); // back/forward restores prior position
    expect(scrollTo).toHaveBeenCalledWith(0, 250);

    restoreScrollPosition("/never-saved"); // no entry → no restore call
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});

describe("attachHistoryFallback (fetch error → full browser navigation)", () => {
  it("falls back to location.href when fetch fails", async () => {
    const hrefSetter = vi.fn();
    Object.defineProperty(globalThis, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/",
        search: "",
        get href() {
          return "";
        },
        set href(v: string) {
          hrefSetter(v);
        }
      },
      configurable: true
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network")))
    );
    const onError = vi.fn();
    const dispose = attachHistoryFallback({ onStart() {}, onEnd() {}, onError });

    document.body.innerHTML = `<a href="/about" id="a">x</a>`;
    const anchor = document.querySelector("#a") as HTMLAnchorElement;
    Object.defineProperty(anchor, "href", { value: "http://localhost:3000/about" });
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalled();
      expect(hrefSetter).toHaveBeenCalledWith("/about");
    });
    dispose();
  });

  it("same-page click scrolls to top without fetching", () => {
    Object.defineProperty(globalThis, "location", {
      value: { origin: "http://localhost:3000", pathname: "/here" },
      configurable: true
    });
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const dispose = attachHistoryFallback({ onStart() {}, onEnd() {}, onError() {} });

    document.body.innerHTML = `<a id="a" href="/here">x</a>`;
    const anchor = document.querySelector("#a") as HTMLAnchorElement;
    Object.defineProperty(anchor, "href", { value: "http://localhost:3000/here" });
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(fetchSpy).not.toHaveBeenCalled();
    dispose();
  });

  it("cross-page click pushes history and hands off to navigate WITHOUT scrolling", async () => {
    Object.defineProperty(globalThis, "location", {
      value: { origin: "http://localhost:3000", pathname: "/" },
      configurable: true
    });
    // Forward nav no longer scrolls in the router: the scroll-to-top is the swap's job
    // (runSwap's `beforeCapture`), fired just before the View Transition snapshot and
    // after the fetch — so there is no scroll delta (no header flicker) and no pre-fetch
    // "scroll up, then load" pause. The kernel's swap-time scroll is covered in kernel.test.
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("<p>ok</p>", { status: 200 })))
    );
    const pushState = vi.spyOn(history, "pushState");
    const onEnd = vi.fn();
    const dispose = attachHistoryFallback({ onStart() {}, onEnd, onError() {} });

    document.body.innerHTML = `<a id="a" href="/next">x</a>`;
    const anchor = document.querySelector("#a") as HTMLAnchorElement;
    Object.defineProperty(anchor, "href", { value: "http://localhost:3000/next" });
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledWith("<p>ok</p>", "/next"));
    expect(pushState).toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    dispose();
  });

  it("popstate re-runs navigation for the current location", async () => {
    Object.defineProperty(globalThis, "location", {
      value: { origin: "http://localhost:3000", pathname: "/back" },
      configurable: true
    });
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("<p>b</p>", { status: 200 })))
    );
    const onEnd = vi.fn();
    const dispose = attachHistoryFallback({ onStart() {}, onEnd, onError() {} });

    globalThis.dispatchEvent(new Event("popstate"));
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledWith("<p>b</p>", "/back"));
    dispose();
  });

  it("dispose removes the click + popstate listeners", () => {
    const remove = vi.spyOn(document, "removeEventListener");
    const dispose = attachHistoryFallback({ onStart() {}, onEnd() {}, onError() {} });
    dispose();
    expect(remove).toHaveBeenCalledWith("click", expect.any(Function));
  });
});

describe("swapRegion / runSwap (View Transitions)", () => {
  it("wraps the swap in startViewTransition when enabled and supported", () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return {};
    });
    (
      document as unknown as { startViewTransition: typeof startViewTransition }
    ).startViewTransition = startViewTransition;
    vi.stubGlobal("matchMedia", () => ({ matches: false }));

    let ran = false;
    runSwap(() => {
      ran = true;
    }, true);
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(ran).toBe(true);
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });

  it("does an instant swap (no throw) when View Transitions are unsupported", () => {
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    let ran = false;
    expect(() =>
      runSwap(() => {
        ran = true;
      }, true)
    ).not.toThrow();
    expect(ran).toBe(true);
  });

  it("runs beforeCapture synchronously BEFORE the snapshot+swap (scroll-before-snapshot)", () => {
    const order: string[] = [];
    const startViewTransition = vi.fn((cb: () => void) => {
      order.push("capture"); // the "old" snapshot is taken here, before the DOM mutates
      cb();
      return {};
    });
    (
      document as unknown as { startViewTransition: typeof startViewTransition }
    ).startViewTransition = startViewTransition;
    vi.stubGlobal("matchMedia", () => ({ matches: false }));

    runSwap(
      () => order.push("swap"),
      true,
      () => order.push("beforeCapture")
    );
    // beforeCapture (e.g. scroll to top) must precede the capture, so scrollY=0 is baked
    // into the "old" snapshot → no scroll delta → the sticky header never un-pins.
    expect(order).toEqual(["beforeCapture", "capture", "swap"]);
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });

  it("runs beforeCapture before an instant swap when View Transitions are unsupported", () => {
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    const order: string[] = [];
    runSwap(
      () => order.push("swap"),
      true,
      () => order.push("beforeCapture")
    );
    expect(order).toEqual(["beforeCapture", "swap"]);
  });

  it("swapRegion replaces the matched region and runs onSwapped", () => {
    document.body.innerHTML = `<main><section id="page">old</section></main>`;
    const doc = new DOMParser().parseFromString(
      `<html><body><main><section id="page">new</section></main></body></html>`,
      "text/html"
    );
    const onSwapped = vi.fn();
    swapRegion(doc, "main > section", false, onSwapped);
    expect(document.querySelector("#page")?.textContent).toBe("new");
    expect(onSwapped).toHaveBeenCalledTimes(1);
  });

  it("swapRegion is a no-op when the region is missing in either document", () => {
    document.body.innerHTML = `<div>no region</div>`;
    const doc = new DOMParser().parseFromString(`<main><section>x</section></main>`, "text/html");
    const onSwapped = vi.fn();
    swapRegion(doc, "main > section", false, onSwapped);
    expect(onSwapped).not.toHaveBeenCalled();
  });
});

describe("performNavigation", () => {
  it("calls onStart then onEnd with the fetched HTML on success", async () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("<p>hi</p>", { status: 200 })))
    );
    await performNavigation("/page", { onStart, onEnd, onError() {} });
    expect(onStart).toHaveBeenCalledWith("/page");
    expect(onEnd).toHaveBeenCalledWith("<p>hi</p>", "/page");
  });

  it("calls onError when the response is not ok", async () => {
    const onError = vi.fn();
    const hrefSetter = vi.fn();
    Object.defineProperty(globalThis, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/",
        get href() {
          return "";
        },
        set href(v: string) {
          hrefSetter(v);
        }
      },
      configurable: true
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 500 })))
    );
    await performNavigation("/x", { onStart() {}, onEnd() {}, onError });
    expect(onError).toHaveBeenCalled();
    expect(hrefSetter).toHaveBeenCalledWith("/x");
  });
});

describe("Navigation API path", () => {
  it("attachRouter uses the Navigation API when present and intercepts internal nav", () => {
    Object.defineProperty(globalThis, "location", {
      value: { origin: "http://localhost:3000", pathname: "/" },
      configurable: true
    });
    const listeners: Array<(e: unknown) => void> = [];
    const navMock = {
      addEventListener: (_t: string, l: (e: unknown) => void) => listeners.push(l),
      removeEventListener: vi.fn()
    };
    vi.stubGlobal("navigation", navMock);
    const handlers: RouterHandlers = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    const dispose = attachRouter(handlers);
    const event = fakeNavEvent();
    listeners[0]?.(event);
    expect(event.intercept).toHaveBeenCalledTimes(1);
    dispose();
    expect(navMock.removeEventListener).toHaveBeenCalled();
  });

  it("ignores non-interceptable and external navigations", () => {
    Object.defineProperty(globalThis, "location", {
      value: { origin: "http://localhost:3000", pathname: "/" },
      configurable: true
    });
    let listener: ((e: unknown) => void) | undefined;
    const navMock = {
      addEventListener: (_t: string, l: (e: unknown) => void) => {
        listener = l;
      },
      removeEventListener: vi.fn()
    };
    const handlers: RouterHandlers = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    attachNavigationApi(navMock as never, handlers);

    const blocked = fakeNavEvent({ canIntercept: false });
    listener?.(blocked);
    expect(blocked.intercept).not.toHaveBeenCalled();
  });
});

describe("Navigation API intercept handlers", () => {
  it("same-page navigation scrolls to top via the intercept handler", async () => {
    Object.defineProperty(globalThis, "location", {
      value: { origin: "http://localhost:3000", pathname: "/about" },
      configurable: true
    });
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const listener = attachAndCapture({ onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() });
    const event = fakeNavEvent({ destination: { url: "http://localhost:3000/about" } });

    listener(event);
    await runIntercept(event);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("traverse navigation defers scroll restoration to the browser", async () => {
    Object.defineProperty(globalThis, "location", {
      value: { origin: "http://localhost:3000", pathname: "/" },
      configurable: true
    });
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("<p>x</p>", { status: 200 })))
    );
    const onEnd = vi.fn();
    const listener = attachAndCapture({ onStart: vi.fn(), onEnd, onError: vi.fn() });
    const event = fakeNavEvent({ navigationType: "traverse" });

    listener(event);
    await runIntercept(event);
    expect(onEnd).toHaveBeenCalledWith("<p>x</p>", "/about");
    expect(event.scroll).toHaveBeenCalledTimes(1);
  });

  it("push navigation hands off to navigate WITHOUT scrolling (scroll is the swap's job)", async () => {
    Object.defineProperty(globalThis, "location", {
      value: { origin: "http://localhost:3000", pathname: "/" },
      configurable: true
    });
    // Forward nav doesn't scroll in the router; the kernel scrolls to top as part of the
    // swap (just before the snapshot, after the fetch). See kernel.test for that assertion.
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("<p>x</p>", { status: 200 })))
    );
    const onEnd = vi.fn();
    const listener = attachAndCapture({ onStart: vi.fn(), onEnd, onError: vi.fn() });
    const event = fakeNavEvent({ navigationType: "push" });

    listener(event);
    await runIntercept(event);
    expect(onEnd).toHaveBeenCalledWith("<p>x</p>", "/about");
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
