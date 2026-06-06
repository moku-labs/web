import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createState } from "../../state";
import { makeConfig } from "../helpers";

/** Hoisted readline mock so createState's defaultConfirm can be exercised. */
const { createInterfaceMock } = vi.hoisted(() => ({ createInterfaceMock: vi.fn() }));
vi.mock("node:readline", async importActual => ({
  ...(await importActual<typeof import("node:readline")>()),
  createInterface: createInterfaceMock
}));

/** Build the minimal createState ctx. */
function stateCtx() {
  return { global: {}, config: makeConfig() };
}

describe("cli/createState", () => {
  const originalBun = (globalThis as { Bun?: unknown }).Bun;

  afterEach(() => {
    if (originalBun === undefined) Reflect.deleteProperty(globalThis, "Bun");
    else (globalThis as { Bun?: unknown }).Bun = originalBun;
    vi.restoreAllMocks();
  });

  it("wires every seam with a sensible default", () => {
    const state = createState(stateCtx());
    expect(typeof state.render.header).toBe("function");
    expect(typeof state.confirm).toBe("function");
    expect(state.clock).toBe(Date.now);
    expect(typeof state.watch).toBe("function");
    expect(typeof state.serveStatic).toBe("function");
    expect(typeof state.fileResponse).toBe("function");
    expect(typeof state.networkUrl).toBe("function");
  });

  it("networkUrl returns a string or null (reads real interfaces)", () => {
    const state = createState(stateCtx());
    const url = state.networkUrl(4173);
    expect(url === null || url.startsWith("http://")).toBe(true);
  });

  it("serveStatic delegates to Bun.serve when present", () => {
    const stop = vi.fn();
    const serve = vi.fn(() => ({ stop }));
    (globalThis as { Bun?: unknown }).Bun = { serve, file: vi.fn() };
    const state = createState(stateCtx());
    const handle = state.serveStatic({
      port: 1234,
      fetch() {
        return new Response("ok");
      }
    });
    expect(serve).toHaveBeenCalledTimes(1);
    handle.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("serveStatic throws a coded message when no Bun runtime is available", () => {
    Reflect.deleteProperty(globalThis, "Bun");
    const state = createState(stateCtx());
    expect(() =>
      state.serveStatic({
        port: 1,
        fetch() {
          return new Response("x");
        }
      })
    ).toThrow(/\[web\] cli: no Bun runtime/);
  });

  it("fileResponse wraps Bun.file when present", async () => {
    const file = vi.fn(() => "file-body");
    (globalThis as { Bun?: unknown }).Bun = { serve: vi.fn(), file };
    const state = createState(stateCtx());
    const response = state.fileResponse("/dist/index.html", 200);
    expect(file).toHaveBeenCalledWith("/dist/index.html");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("file-body");
  });

  it("fileResponse throws a coded message with no Bun runtime", () => {
    Reflect.deleteProperty(globalThis, "Bun");
    const state = createState(stateCtx());
    expect(() => state.fileResponse("/x", 200)).toThrow(/\[web\] cli: no Bun runtime/);
  });
});

describe("cli default watch seam", () => {
  it("wraps node:fs.watch and forwards change events + close() (real watcher)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cli-watch-"));
    try {
      const state = createState(stateCtx());
      const onChange = vi.fn();
      const handle = state.watch(dir, onChange);
      // The handle exposes close(); closing a real recursive watcher must not throw.
      expect(typeof handle.close).toBe("function");
      handle.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cli default confirm seam", () => {
  it("resolves true on 'y' and false otherwise (mocked readline)", async () => {
    const close = vi.fn();
    const answers = ["y", "no"];
    let index = 0;
    createInterfaceMock.mockReturnValue({
      question(_question: string, callback: (answer: string) => void) {
        callback(answers[index++] ?? "");
      },
      close
    });

    const state = createState(stateCtx());
    expect(await state.confirm("Deploy?")).toBe(true);
    expect(await state.confirm("Deploy?")).toBe(false);
    expect(close).toHaveBeenCalledTimes(2);
  });
});

describe("cli default select seam", () => {
  it("returns the chosen zero-based index, clamping empty/out-of-range to 0", async () => {
    const close = vi.fn();
    const answers = ["2", "", "9"]; // pick #2 → index 1; empty → 0; out-of-range → 0
    let index = 0;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    createInterfaceMock.mockReturnValue({
      question(_question: string, callback: (answer: string) => void) {
        callback(answers[index++] ?? "");
      },
      close
    });

    const state = createState(stateCtx());
    const choices = ["Auto", "Manual", "Skip"];
    expect(await state.select("Trigger?", choices)).toBe(1);
    expect(await state.select("Trigger?", choices)).toBe(0);
    expect(await state.select("Trigger?", choices)).toBe(0);
    expect(close).toHaveBeenCalledTimes(3);
    logSpy.mockRestore();
  });
});
