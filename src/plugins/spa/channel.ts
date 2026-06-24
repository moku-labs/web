/**
 * @file spa plugin — `createChannel`, a client realtime WebSocket primitive.
 *
 * A live, self-healing message channel for islands that consume a server push stream
 * (e.g. a Durable Object broadcasting board patches). It owns the parts every real-time
 * app otherwise hand-rolls: a single active socket bound to one channel `id`, refcounted
 * `subscribe` (first subscriber connects, last disconnects — so cross-island mount order
 * stops being load-bearing), exponential-backoff auto-reconnect, an optional keepalive
 * ping, a pre-seed buffer (frames that arrive before the island's snapshot loads are
 * queued and flushed on `seed`, so the connect→load race drops nothing), and an
 * optimistic `deliverLocal` echo.
 *
 * Browser-only (uses `WebSocket`); reached ONLY through an explicit `createChannel(...)`
 * call, so an app that never opens a channel never pulls this module into its graph.
 * @see {@link createChannel} for the usage example.
 */

/** Keepalive configuration: a frame sent on an interval, and the reply to ignore. */
export interface ChannelKeepAlive {
  /** The keepalive frame to send (e.g. `"ping"`). */
  send: string;
  /** A reply frame to ignore rather than parse (e.g. `"pong"`). */
  ignore?: string;
  /** Interval between keepalive sends, in ms. Defaults to `30000`. */
  everyMs?: number;
}

/** Auto-reconnect backoff configuration (exponential, capped). */
export interface ChannelReconnect {
  /** First retry delay in ms (doubles each attempt). Defaults to `500`. */
  baseMs?: number;
  /** Maximum retry delay in ms (the backoff ceiling). Defaults to `8000`. */
  maxMs?: number;
}

/** Options for {@link createChannel}. */
export interface ChannelOptions<T> {
  /** Build the `ws(s)://` URL for a channel `id`. */
  url: (id: string) => string;
  /**
   * Parse a raw text frame into a message, or return `undefined` to drop it (malformed
   * frame / keepalive reply). Defaults to `JSON.parse` (dropping frames that fail to parse).
   */
  parse?: (raw: string) => T | undefined;
  /** Keepalive ping configuration (off when omitted). */
  keepAlive?: ChannelKeepAlive;
  /** Auto-reconnect backoff (defaults applied when omitted; pass `false` to disable). */
  reconnect?: ChannelReconnect | false;
  /**
   * Buffer frames that arrive before {@link Channel.seed} and flush them (in arrival
   * order) on seed, closing the connect→load race. Defaults to `false` (deliver live).
   */
  bufferUntilSeed?: boolean;
}

/** A live realtime channel (the surface returned by {@link createChannel}). */
export interface Channel<T> {
  /**
   * Subscribe to messages for channel `id`, connecting (or switching) the single
   * active socket to it. Refcounted: the first subscriber connects, the last to
   * unsubscribe disconnects. Returns an unsubscribe function.
   *
   * @param id - The channel id to subscribe to.
   * @param handler - Called with each delivered message.
   * @returns A function that removes this handler (and disconnects when it was the last).
   */
  subscribe(id: string, handler: (message: T) => void): () => void;
  /**
   * Mark the channel seeded and flush the pre-seed buffer (no-op unless
   * `bufferUntilSeed` and `id` is the active channel). Idempotent.
   *
   * @param id - The channel id whose buffer to flush (must be the active id).
   */
  seed(id: string): void;
  /**
   * Deliver a message to the local handlers immediately (the optimistic-update path —
   * the acting client reflects its own mutation without waiting for the server echo).
   *
   * @param id - The channel id (must be the active id; ignored otherwise).
   * @param message - The message to deliver locally now.
   */
  deliverLocal(id: string, message: T): void;
  /**
   * Send a raw text frame over the live socket (no-op when not open).
   *
   * @param raw - The frame to send.
   */
  send(raw: string): void;
  /**
   * The currently-subscribed channel id, or `undefined` when disconnected.
   *
   * @returns The active id, or undefined.
   */
  current(): string | undefined;
  /** Close the socket, cancel reconnect, and clear all handlers. */
  disconnect(): void;
}

/** Default keepalive interval (ms). */
const DEFAULT_KEEPALIVE_MS = 30_000;
/** Default first reconnect delay (ms). */
const DEFAULT_RECONNECT_BASE_MS = 500;
/** Default reconnect ceiling (ms). */
const DEFAULT_RECONNECT_MAX_MS = 8000;

/**
 * Default frame parser — `JSON.parse`, dropping frames that fail to parse.
 *
 * @param raw - The raw text frame.
 * @returns The parsed value, or undefined on a parse error.
 * @example
 * const msg = defaultParse<BoardPatch>('{"type":"x"}');
 */
function defaultParse<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * Create a live realtime channel — a single self-healing WebSocket bound to one channel
 * `id` at a time, with refcounted subscription, auto-reconnect, an optional keepalive, a
 * pre-seed buffer, and an optimistic local-echo path. See the file header for the model.
 *
 * @param options - The channel configuration (see {@link ChannelOptions}).
 * @returns The {@link Channel} control surface.
 * @example
 * const board = createChannel<BoardPatch>({ url: (id) => `wss://host/ws/board/${id}` });
 */
export function createChannel<T>(options: ChannelOptions<T>): Channel<T> {
  const parse = options.parse ?? defaultParse<T>;
  const reconnectCfg = options.reconnect === false ? undefined : (options.reconnect ?? {});
  const baseMs = reconnectCfg?.baseMs ?? DEFAULT_RECONNECT_BASE_MS;
  const maxMs = reconnectCfg?.maxMs ?? DEFAULT_RECONNECT_MAX_MS;
  const keepEveryMs = options.keepAlive?.everyMs ?? DEFAULT_KEEPALIVE_MS;

  /** The live socket, or undefined when disconnected. */
  let socket: WebSocket | undefined;
  /** The id we WANT to stay subscribed to (drives reconnect); undefined ⇒ intentionally off. */
  let desiredId: string | undefined;
  /** Whether the consumer has seeded — gates live delivery vs. buffering. */
  let seeded = false;
  /** Frames received before {@link Channel.seed}, replayed in arrival order on seed. */
  let buffer: T[] = [];
  /** Message handlers fanned out on every delivered frame. */
  const handlers = new Set<(message: T) => void>();
  /** Consecutive closes since the last clean open — drives the backoff delay. */
  let reconnectAttempts = 0;
  /** Pending reconnect timer handle, or undefined when none is scheduled. */
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  /** Keepalive interval handle, or undefined when off. */
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

  /**
   * Fan a message out to every handler now, or queue it when buffering before seed.
   *
   * @param message - The message to deliver or buffer.
   * @example
   * deliver(patch);
   */
  function deliver(message: T): void {
    if (options.bufferUntilSeed && !seeded) {
      buffer.push(message);
      return;
    }
    for (const handler of handlers) handler(message);
  }

  /**
   * Parse + route an incoming frame, dropping the keepalive reply and unparseable frames.
   *
   * @param event - The socket message event.
   * @example
   * socket.addEventListener("message", dispatch);
   */
  function dispatch(event: MessageEvent): void {
    if (typeof event.data !== "string") return;
    if (options.keepAlive?.ignore !== undefined && event.data === options.keepAlive.ignore) return;
    const message = parse(event.data);
    if (message !== undefined) deliver(message);
  }

  /**
   * Send the keepalive frame when the socket is open (no-op otherwise).
   *
   * @example
   * ping();
   */
  function ping(): void {
    if (options.keepAlive && socket?.readyState === WebSocket.OPEN) {
      socket.send(options.keepAlive.send);
    }
  }

  /**
   * Open the live socket for {@link desiredId}, wiring delivery + auto-reconnect. Shared by
   * the first connect and every backoff retry.
   *
   * @example
   * openSocket();
   */
  function openSocket(): void {
    const id = desiredId;
    if (id === undefined || typeof WebSocket === "undefined") return;

    const ws = new WebSocket(options.url(id));
    socket = ws;
    ws.addEventListener("message", dispatch);
    ws.addEventListener("open", () => {
      reconnectAttempts = 0;
    });
    ws.addEventListener("close", () => {
      // Only this socket's close matters — a stale close after we moved on must not reconnect.
      if (socket !== ws || desiredId === undefined) return;
      socket = undefined;
      if (reconnectCfg) scheduleReconnect();
    });
  }

  /**
   * Schedule a reconnect to {@link desiredId} with exponential backoff (capped), unless one
   * is already pending or reconnection is off.
   *
   * @example
   * scheduleReconnect();
   */
  function scheduleReconnect(): void {
    if (reconnectTimer !== undefined || desiredId === undefined) return;
    const delay = Math.min(baseMs * 2 ** reconnectAttempts, maxMs);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      if (desiredId !== undefined) openSocket();
    }, delay);
  }

  /**
   * Tear down the live socket + timers and re-arm the pre-seed buffer, keeping handlers so a
   * later connect resumes delivering to them. Clearing {@link desiredId} first marks the drop
   * intentional (no reconnect).
   *
   * @example
   * teardown();
   */
  function teardown(): void {
    desiredId = undefined;
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    if (keepAliveTimer !== undefined) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = undefined;
    }
    if (socket) {
      socket.removeEventListener("message", dispatch);
      socket.close();
      socket = undefined;
    }
    seeded = false;
    buffer = [];
  }

  /**
   * Open (or switch) the socket to `id`, re-arming the keepalive + pre-seed buffer.
   *
   * @param id - The channel id to connect to.
   * @example
   * connect("board-123");
   */
  function connect(id: string): void {
    const alive =
      socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN;
    if (desiredId === id && alive) return;

    teardown();
    desiredId = id;
    seeded = false;
    buffer = [];
    reconnectAttempts = 0;
    openSocket();
    if (options.keepAlive) keepAliveTimer = setInterval(ping, keepEveryMs);
  }

  return {
    /**
     * Subscribe to `id`, connecting (or switching) the single active socket. Refcounted.
     *
     * @param id - The channel id to subscribe to.
     * @param handler - Called with each delivered message.
     * @returns A function that removes this handler (last out disconnects).
     * @example
     * const off = board.subscribe(boardId, (patch) => applyPatch(ctx, patch));
     */
    subscribe(id, handler) {
      handlers.add(handler);
      connect(id);
      return () => {
        handlers.delete(handler);
        // Last subscriber out turns the lights off (refcounted disconnect).
        if (handlers.size === 0) teardown();
      };
    },
    /**
     * Mark `id` seeded and flush the pre-seed buffer (no-op unless it is the active id).
     *
     * @param id - The channel id whose buffer to flush.
     * @example
     * board.seed(boardId);
     */
    seed(id) {
      if (id !== desiredId || seeded) return;
      seeded = true;
      const queued = buffer;
      buffer = [];
      for (const message of queued) {
        for (const handler of handlers) handler(message);
      }
    },
    /**
     * Deliver a message to the local handlers immediately (optimistic echo) for the active id.
     *
     * @param id - The channel id (ignored unless it is the active id).
     * @param message - The message to deliver locally now.
     * @example
     * board.deliverLocal(boardId, { type: "issue.moved", issueId });
     */
    deliverLocal(id, message) {
      if (id !== desiredId) return;
      for (const handler of handlers) handler(message);
    },
    /**
     * Send a raw text frame over the live socket (no-op when not open).
     *
     * @param raw - The frame to send.
     * @example
     * board.send("ping");
     */
    send(raw) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(raw);
    },
    /**
     * The currently-subscribed channel id, or undefined when disconnected.
     *
     * @returns The active id, or undefined.
     * @example
     * board.current();
     */
    current() {
      return desiredId;
    },
    /**
     * Close the socket, cancel reconnect, and clear all handlers.
     *
     * @example
     * board.disconnect();
     */
    disconnect() {
      handlers.clear();
      teardown();
    }
  };
}
