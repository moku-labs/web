/* eslint-disable sonarjs/no-clear-text-protocols -- local dev/preview URLs are intentionally http. */
import { describe, expect, it } from "vitest";
import { box, makePalette, supportsColor, visibleWidth } from "../../render/ansi";
import { createPanelRenderer } from "../../render/panel";

/** Build a panel renderer capturing stdout + stderr lines, with color forced off. */
function capture(color = false) {
  const out: string[] = [];
  const err: string[] = [];
  const render = createPanelRenderer({
    write: line => out.push(line),
    writeError: line => err.push(line),
    color
  });
  return { render, out, err };
}

describe("cli panel renderer (plain mode)", () => {
  it("renders a boxed MOKU WEB header with the command label", () => {
    const { render, out } = capture();
    render.header("build");
    const joined = out.join("\n");
    expect(joined).toContain("MOKU WEB");
    expect(joined).toContain("build");
    // ASCII box borders in plain mode.
    expect(out[0]).toMatch(/^\+-+\+$/);
    expect(out.at(-1)).toMatch(/^\+-+\+$/);
  });

  it("renders live phase rows with a ✓ on done and the duration", () => {
    const { render, out } = capture();
    render.phase({ phase: "pages", status: "start" });
    render.phase({ phase: "pages", status: "done", durationMs: 12 });
    expect(out.join("\n")).toContain("pages");
    expect(out.join("\n")).toContain("✓");
    expect(out.join("\n")).toContain("12ms");
  });

  it("renders the BUILD summary block with page count, time and out dir", () => {
    const { render, out } = capture();
    render.built({ outDir: "dist", pageCount: 7, durationMs: 840 });
    const joined = out.join("\n");
    expect(joined).toContain("BUILD");
    expect(joined).toContain("7");
    expect(joined).toContain("840ms");
    expect(joined).toContain("dist/");
  });

  it("renders the server-ready panel with Local and Network URLs + watched dirs", () => {
    const { render, out } = capture();
    render.serverReady({
      local: "http://localhost:4173",
      network: "http://192.168.1.2:4173",
      watching: ["content", "src"]
    });
    const joined = out.join("\n");
    expect(joined).toContain("Local");
    expect(joined).toContain("http://localhost:4173");
    expect(joined).toContain("Network");
    expect(joined).toContain("http://192.168.1.2:4173");
    expect(joined).toContain("content, src");
  });

  it("shows 'unavailable' when there is no network URL", () => {
    const { render, out } = capture();
    // eslint-disable-next-line unicorn/no-null -- ServerInfo.network is `string | null` by contract.
    render.serverReady({ local: "http://localhost:4173", network: null });
    expect(out.join("\n")).toContain("unavailable");
  });

  it("renders a reload line with ~ file and the rebuilt summary", () => {
    const { render, out } = capture();
    render.reload({ file: "content/a.md", pageCount: 3, durationMs: 42 });
    const joined = out.join("\n");
    expect(joined).toContain("~ content/a.md");
    expect(joined).toContain("rebuilt 3 pages");
    expect(joined).toContain("42ms");
  });

  it("renders the deploy panel with the URL, branch and id", () => {
    const { render, out } = capture();
    render.deployed({
      url: "https://x.pages.dev",
      deploymentId: "abc123",
      branch: "main",
      durationMs: 1200
    });
    const joined = out.join("\n");
    expect(joined).toContain("DEPLOYED");
    expect(joined).toContain("https://x.pages.dev");
    expect(joined).toContain("main");
    expect(joined).toContain("abc123");
  });

  it("routes info to stdout and warn/error to stderr", () => {
    const { render, out, err } = capture();
    render.info("hello");
    render.warn("careful");
    render.error("boom", new Error("cause"));
    expect(out.join("\n")).toContain("hello");
    expect(err.join("\n")).toContain("careful");
    expect(err.join("\n")).toContain("boom");
    expect(err.join("\n")).toContain("cause");
  });

  it("emits NO ANSI escape codes when color is disabled (NO_COLOR / non-TTY)", () => {
    const { render, out, err } = capture(false);
    render.header("serve");
    render.built({ outDir: "dist", pageCount: 1, durationMs: 1 });
    render.warn("w");
    for (const line of [...out, ...err]) {
      expect(line).not.toMatch(new RegExp(String.fromCodePoint(0x1b)));
    }
  });

  it("emits ANSI escape codes when color is enabled", () => {
    const { render, out } = capture(true);
    render.header("deploy");
    expect(out.join("\n")).toMatch(new RegExp(String.fromCodePoint(0x1b)));
  });

  it("prints ONE line per completed phase off a TTY (no start/done duplication)", () => {
    const { render, out } = capture();
    render.phase({ phase: "bundle", status: "start" });
    expect(out).toHaveLength(0); // the "start" boundary draws nothing in plain mode
    render.phase({ phase: "bundle", status: "done", durationMs: 5 });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("✓");
    expect(out[0]).toContain("bundle");
    expect(out[0]).toContain("5ms");
  });

  it("suppresses phase rows + the BUILD box while a rebuild is in flight", () => {
    const { render, out } = capture();
    render.rebuildStart("content");
    render.phase({ phase: "pages", status: "start" });
    render.phase({ phase: "pages", status: "done", durationMs: 9 });
    render.built({ outDir: "dist", pageCount: 4, durationMs: 50 });
    // Nothing from the suppressed phase/built calls leaked (no phase duration, no BUILD box).
    expect(out.join("\n")).not.toContain("9ms");
    expect(out.join("\n")).not.toContain("BUILD");
    render.reload({ file: "content", pageCount: 4, durationMs: 50 });
    expect(out.join("\n")).toContain("rebuilt 4 pages");
  });
});

/** A renderer with color on + injected raw/clock sinks, for in-place (TTY) assertions. */
function captureColor() {
  const out: string[] = [];
  const err: string[] = [];
  const raw: string[] = [];
  let clock = 1000;
  const render = createPanelRenderer({
    write: line => out.push(line),
    writeError: line => err.push(line),
    writeRaw: chunk => raw.push(chunk),
    color: true,
    now: () => clock
  });
  return {
    render,
    out,
    err,
    raw,
    advance: (ms: number) => {
      clock += ms;
    }
  };
}

describe("cli panel renderer (live TTY rendering)", () => {
  it("draws an in-place rebuilding spinner and overwrites it with the result on reload", () => {
    const { render, raw, out } = captureColor();
    render.rebuildStart("content");
    expect(raw.join("")).toContain("rebuilding content");
    // The spinner line is drawn in place (carriage return + clear line), not appended.
    expect(raw.join("")).toContain("\r");
    render.reload({ file: "content", pageCount: 7, durationMs: 80 });
    // The result line replaces the spinner in place (count is ANSI-bolded, so assert parts).
    const joined = raw.join("");
    expect(joined).toContain("rebuilt");
    expect(joined).toContain("7");
    expect(joined).toContain("reloaded");
    // Everything stayed in the raw (in-place) sink — nothing scrolled via the line sink.
    expect(out).toHaveLength(0);
  });

  it("keeps a single live phase row per phase, keyed by name (interleaved events)", () => {
    const { render, raw } = captureColor();
    render.phase({ phase: "content", status: "start" });
    render.phase({ phase: "images", status: "start" });
    render.phase({ phase: "images", status: "done", durationMs: 3 });
    render.phase({ phase: "content", status: "done", durationMs: 9 });
    // The final in-place repaint shows BOTH phases as done rows — no duplicated lines.
    const last = raw.at(-1) ?? "";
    expect(last).toContain("content");
    expect(last).toContain("images");
    expect(last).toContain("9ms");
    expect(last).toContain("3ms");
  });

  it("clears the in-place spinner line before printing a rebuild error", () => {
    const { render, raw, err } = captureColor();
    render.rebuildStart("content");
    render.error("rebuild failed", new Error("boom"));
    expect(err.join("\n")).toContain("rebuild failed");
    expect(err.join("\n")).toContain("boom");
    // The last raw write clears the spinner line (carriage return + ANSI clear) first.
    expect(raw.at(-1)).toContain("\r");
    expect(raw.at(-1)).toContain(String.fromCodePoint(0x1b));
  });
});

describe("cli ansi helpers", () => {
  it("supportsColor is false for a non-TTY stream", () => {
    expect(supportsColor({ isTTY: false }, undefined)).toBe(false);
  });

  it("supportsColor is false when NO_COLOR is set even on a TTY", () => {
    expect(supportsColor({ isTTY: true }, "1")).toBe(false);
  });

  it("supportsColor is true on a TTY with NO_COLOR unset", () => {
    expect(supportsColor({ isTTY: true }, undefined)).toBe(true);
  });

  it("makePalette returns input unchanged in plain mode and wraps in color mode", () => {
    expect(makePalette(false).green("x")).toBe("x");
    expect(makePalette(true).green("x")).not.toBe("x");
    expect(makePalette(true).green("x")).toContain("x");
  });

  it("visibleWidth ignores ANSI escapes", () => {
    const colored = makePalette(true).red("hi");
    expect(visibleWidth(colored)).toBe(2);
  });

  it("box frames content and pads to the widest visible line (ASCII)", () => {
    const lines = box(["a", "longer line"], false);
    expect(lines[0]).toMatch(/^\+-+\+$/);
    expect(lines.at(-1)).toMatch(/^\+-+\+$/);
    // Every row has equal total width.
    const widths = new Set(lines.map(line => line.length));
    expect(widths.size).toBe(1);
  });
});
