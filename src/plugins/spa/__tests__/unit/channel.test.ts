// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChannel } from "../../channel";

/** A controllable mock WebSocket: tests drive open/message/close + inspect sends. */
class MockSocket {
  static readonly instances: MockSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, Array<(event: unknown) => void>> = {};
  constructor(public url: string) {
    MockSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (event: unknown) => void): void {
    const list = this.listeners[type] ?? [];
    list.push(fn);
    this.listeners[type] = list;
  }
  removeEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter(l => l !== fn);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.readyState = MockSocket.CLOSED;
  }
  // Test drivers:
  fireOpen(): void {
    this.readyState = MockSocket.OPEN;
    for (const l of this.listeners.open ?? []) l({});
  }
  fireMessage(data: string): void {
    for (const l of this.listeners.message ?? []) l({ data });
  }
  fireClose(): void {
    this.readyState = MockSocket.CLOSED;
    for (const l of this.listeners.close ?? []) l({});
  }
}

beforeEach(() => {
  MockSocket.instances.length = 0;
  vi.stubGlobal("WebSocket", MockSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface Patch {
  type: string;
  id?: string;
}

describe("createChannel", () => {
  it("connects on first subscribe using the url builder and delivers parsed frames", () => {
    const channel = createChannel<Patch>({ url: id => `wss://h/ws/${id}` });
    const seen: Patch[] = [];
    channel.subscribe("b1", p => seen.push(p));

    expect(MockSocket.instances).toHaveLength(1);
    expect(MockSocket.instances[0]?.url).toBe("wss://h/ws/b1");
    expect(channel.current()).toBe("b1");

    MockSocket.instances[0]?.fireMessage(JSON.stringify({ type: "issue.created", id: "i1" }));
    expect(seen).toEqual([{ type: "issue.created", id: "i1" }]);
  });

  it("drops unparseable frames and the keepalive reply", () => {
    const channel = createChannel<Patch>({
      url: () => "wss://h",
      keepAlive: { send: "ping", ignore: "pong" }
    });
    const seen: Patch[] = [];
    channel.subscribe("b1", p => seen.push(p));
    const socket = MockSocket.instances[0];

    socket?.fireMessage("pong"); // keepalive reply — ignored
    socket?.fireMessage("not json"); // unparseable — dropped
    socket?.fireMessage(JSON.stringify({ type: "ok" }));
    expect(seen).toEqual([{ type: "ok" }]);
  });

  it("buffers pre-seed frames and flushes them in order on seed (connect→load race)", () => {
    const channel = createChannel<Patch>({ url: () => "wss://h", bufferUntilSeed: true });
    const seen: Patch[] = [];
    channel.subscribe("b1", p => seen.push(p));
    const socket = MockSocket.instances[0];

    socket?.fireMessage(JSON.stringify({ type: "a" }));
    socket?.fireMessage(JSON.stringify({ type: "b" }));
    expect(seen).toEqual([]); // held until seed

    channel.seed("b1");
    expect(seen).toEqual([{ type: "a" }, { type: "b" }]);

    socket?.fireMessage(JSON.stringify({ type: "c" })); // after seed → live
    expect(seen).toEqual([{ type: "a" }, { type: "b" }, { type: "c" }]);
  });

  it("deliverLocal fans out immediately (optimistic echo) for the active id", () => {
    const channel = createChannel<Patch>({ url: () => "wss://h" });
    const seen: Patch[] = [];
    channel.subscribe("b1", p => seen.push(p));

    channel.deliverLocal("b1", { type: "issue.moved", id: "i1" });
    expect(seen).toEqual([{ type: "issue.moved", id: "i1" }]);
    // A foreign id is ignored.
    channel.deliverLocal("other", { type: "x" });
    expect(seen).toHaveLength(1);
  });

  it("is refcounted: the last subscriber out closes the socket", () => {
    const channel = createChannel<Patch>({ url: () => "wss://h" });
    const off1 = channel.subscribe("b1", () => {});
    const off2 = channel.subscribe("b1", () => {});
    expect(MockSocket.instances).toHaveLength(1);

    off1();
    expect(MockSocket.instances[0]?.closed).toBe(false); // still one subscriber
    off2();
    expect(MockSocket.instances[0]?.closed).toBe(true); // last out → disconnect
    expect(channel.current()).toBeUndefined();
  });

  it("switches the socket when a subscribe targets a different id", () => {
    const channel = createChannel<Patch>({ url: id => `wss://h/${id}` });
    channel.subscribe("b1", () => {});
    expect(channel.current()).toBe("b1");
    channel.subscribe("b2", () => {});
    expect(MockSocket.instances).toHaveLength(2);
    expect(MockSocket.instances[0]?.closed).toBe(true);
    expect(channel.current()).toBe("b2");
  });

  it("auto-reconnects with backoff on an unexpected close (while still desired)", () => {
    vi.useFakeTimers();
    const channel = createChannel<Patch>({
      url: () => "wss://h",
      reconnect: { baseMs: 500, maxMs: 8000 }
    });
    channel.subscribe("b1", () => {});
    expect(MockSocket.instances).toHaveLength(1);

    MockSocket.instances[0]?.fireClose(); // unexpected drop
    vi.advanceTimersByTime(500);
    expect(MockSocket.instances).toHaveLength(2); // reconnected
    expect(channel.current()).toBe("b1");
  });

  it("does NOT reconnect after an intentional disconnect", () => {
    vi.useFakeTimers();
    const channel = createChannel<Patch>({ url: () => "wss://h" });
    channel.subscribe("b1", () => {});
    channel.disconnect();
    const socket = MockSocket.instances[0];
    socket?.fireClose();
    vi.advanceTimersByTime(10_000);
    expect(MockSocket.instances).toHaveLength(1); // no reconnect
    expect(channel.current()).toBeUndefined();
  });

  it("sends the keepalive frame on its interval while open", () => {
    vi.useFakeTimers();
    const channel = createChannel<Patch>({
      url: () => "wss://h",
      keepAlive: { send: "ping", everyMs: 1000 }
    });
    channel.subscribe("b1", () => {});
    const socket = MockSocket.instances[0];
    socket?.fireOpen();
    vi.advanceTimersByTime(1000);
    expect(socket?.sent).toContain("ping");
  });
});
