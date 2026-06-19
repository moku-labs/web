/* eslint-disable sonarjs/no-clear-text-protocols -- local dev/preview URLs are intentionally http. */
/**
 * Golden snapshot gate for the "Velocity Lockup" brand panels. Locks the exact rendered
 * output of the deterministic boxes (BUILD / server-ready / deploy / reload) in plain and
 * color modes, with the clock + version pinned. This is the regression gate for extracting
 * the ANSI primitives into `@moku-labs/common/cli`: the output must be byte-identical
 * before and after the move (the header is intentionally excluded — its runtime-facts line
 * varies by machine; `panel-render.test.ts` covers the lockup's structure).
 */
import { describe, expect, it } from "vitest";
import { createPanelRenderer } from "../../render/panel";

/** A panel renderer with pinned clock/version, in-place raw writes ignored, color forced. */
function snap(color: boolean) {
  const out: string[] = [];
  const err: string[] = [];
  const render = createPanelRenderer({
    write: line => out.push(line),
    writeError: line => err.push(line),
    writeRaw: () => {},
    color,
    now: () => 1000,
    version: "v9.9.9",
    coreVersion: "0.0.0"
  });
  return { render, out, err };
}

describe("panel golden output — plain mode", () => {
  it("BUILD summary box", () => {
    const { render, out } = snap(false);
    render.built({ outDir: "dist", pageCount: 12, durationMs: 840 });
    render.dispose();
    expect(out).toMatchSnapshot();
  });

  it("server-ready box", () => {
    const { render, out } = snap(false);
    render.serverReady({
      local: "http://localhost:4173",
      network: "http://192.168.1.2:4173",
      watching: ["content", "src"]
    });
    render.dispose();
    expect(out).toMatchSnapshot();
  });

  it("deploy box", () => {
    const { render, out } = snap(false);
    render.deployed({
      url: "https://x.pages.dev",
      deploymentId: "abc123",
      branch: "main",
      durationMs: 1200
    });
    render.dispose();
    expect(out).toMatchSnapshot();
  });

  it("reload line", () => {
    const { render, out } = snap(false);
    render.reload({ file: "content/a.md", pageCount: 3, durationMs: 42 });
    render.dispose();
    expect(out).toMatchSnapshot();
  });
});

describe("panel golden output — color mode", () => {
  it("BUILD summary box (ANSI)", () => {
    const { render, out } = snap(true);
    render.built({ outDir: "dist", pageCount: 12, durationMs: 840 });
    render.dispose();
    expect(out).toMatchSnapshot();
  });

  it("deploy box (ANSI)", () => {
    const { render, out } = snap(true);
    render.deployed({
      url: "https://x.pages.dev",
      deploymentId: "abc123",
      branch: "main",
      durationMs: 1200
    });
    render.dispose();
    expect(out).toMatchSnapshot();
  });
});
