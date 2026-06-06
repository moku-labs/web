/**
 * @file cli plugin — the Panel renderer (the "Velocity Lockup" CLI identity). Produces
 * the `▟▙ moku web` lockup + version/runtime banner, the live phase tree with an
 * animated indeterminate build bar, the BUILD summary + throughput sparkline, the
 * server-ready rail with a persistent breathing `◍ live` idle pulse, the compact
 * rebuild line, the deploy result, and diagnostic heading/check rows. TTY/`NO_COLOR`-
 * aware via {@link makePalette} (24-bit brand pink when truecolor is available, the
 * 16-color magenta approximation otherwise, plain text off a TTY); every line is
 * written through an injectable sink so tests can capture it.
 */
import type { CliRenderer, Command } from "../types";
import {
  box,
  CLEAR_BELOW,
  CLEAR_LINE,
  cursorUp,
  makePalette,
  type Palette,
  spinnerFrameAt,
  supportsColor,
  supportsTruecolor,
  visibleWidth
} from "./ansi";

/**
 * Options for {@link createPanelRenderer}. All optional: the defaults wire the
 * renderer to `console.log`/`console.error` with auto-detected color/truecolor, while
 * tests inject a capturing sink and force `color: false` for deterministic plain output.
 *
 * @example
 * const lines: string[] = [];
 * const render = createPanelRenderer({ write: line => lines.push(line), color: false });
 */
export type PanelOptions = {
  /** Sink for normal (stdout) lines. Defaults to `console.log`. */
  write?: (line: string) => void;
  /** Sink for warning/error (stderr) lines. Defaults to `console.error`. */
  writeError?: (line: string) => void;
  /** Force color on/off. Defaults to `supportsColor()` (TTY + `NO_COLOR` unset). */
  color?: boolean;
  /** Force 24-bit truecolor on/off. Defaults to `supportsTruecolor()` (`COLORTERM`). */
  truecolor?: boolean;
  /**
   * Raw stdout sink that writes a chunk WITHOUT an implicit newline — used for the
   * in-place, cursor-controlled live rendering (phase tree, build bar, rebuild spinner,
   * idle pulse) that runs only when `color` is on. Defaults to `process.stdout.write`;
   * tests inject a capture.
   */
  writeRaw?: (chunk: string) => void;
  /** Monotonic clock (ms) driving every spinner/bar/pulse animation. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * The `@moku-labs/web` version shown top-right in the banner — a fully-formed display
   * string (e.g. `v1.2.0`, `dev·e0d91a1`). Defaults to `"dev"`.
   */
  version?: string;
  /** The pinned `@moku-labs/core` version shown in the facts line (omitted when absent). */
  coreVersion?: string;
};

/** Per-command label shown beside the lockup wordmark. */
const COMMAND_LABEL: Record<Command, string> = {
  build: "build",
  serve: "serve · dev",
  preview: "preview",
  deploy: "deploy"
};

/** Total visible width the header rule spans and the per-row timing column right-aligns to. */
const RAIL_WIDTH = 66;

/** Animation repaint cadence (ms) — how often the live region is redrawn when the loop is free. */
const TICK_MS = 40;

/** Spinner frame interval (ms) — one braille glyph advance per this many elapsed ms. */
const SPIN_MS = 60;

/** Inner (content) width of the BUILD/server boxes so their right edge lines up with the phase tree. */
const BOX_INNER = RAIL_WIDTH - 4;

/** The eight block glyphs the per-phase time-profile sparkline maps durations onto. */
const SPARK_BARS = "▁▂▃▄▅▆▇█";

/**
 * Build a sparkline from a list of values — one block glyph per value, height scaled to
 * the largest value so the tallest bar is `█`. A real micro-histogram (no fake data):
 * under the BUILD summary each bar is one phase's duration, so the slowest phase stands
 * out at a glance. Returns `""` for an empty list.
 *
 * @param values - The values to plot (e.g. per-phase durations in ms).
 * @returns The sparkline string.
 * @example
 * sparkline([12, 1701, 19698, 9]); // "▁▁█▁"
 */
function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  return values
    .map(value => {
      const index = Math.min(
        SPARK_BARS.length - 1,
        Math.floor((value / max) * (SPARK_BARS.length - 1))
      );
      return SPARK_BARS[index] ?? SPARK_BARS[0];
    })
    .join("");
}

/**
 * The structural glyph set for the active color mode: Unicode on a color-capable TTY,
 * ASCII fallbacks off it. Only the NEW Velocity chrome (cube, rule, tree, bar, live
 * dot) degrades here — the `✓ ✗ ~ ➜ ›` status marks stay as-is in both modes.
 *
 * @param color - Whether color/Unicode output is enabled.
 * @returns The matching glyph set.
 * @example
 * const g = glyphSet(true);
 */
function glyphSet(color: boolean) {
  return color
    ? {
        cube: "▟▙",
        rule: "─",
        tree: "├─",
        barFill: "━",
        barTrack: "╴",
        liveOn: "◍",
        liveOff: "○"
      }
    : {
        cube: "*",
        rule: "-",
        tree: "-",
        barFill: "#",
        barTrack: "-",
        liveOn: "*",
        liveOff: "*"
      };
}

/**
 * Render one human-readable duration suffix (e.g. `· 84ms`).
 *
 * @param palette - The active color palette.
 * @param durationMs - Duration in milliseconds (omitted → empty string).
 * @returns The dim `· Nms` suffix, or `""` when no duration is given.
 * @example
 * durationSuffix(palette, 84); // " · 84ms" (dim)
 */
function durationSuffix(palette: Palette, durationMs: number | undefined): string {
  if (durationMs === undefined) return "";
  const dimmed = palette.dim(`· ${durationMs}ms`);
  return ` ${dimmed}`;
}

/**
 * Right-align `right` against `left` within {@link RAIL_WIDTH}, measuring visible width
 * so embedded ANSI never throws the timing column off.
 *
 * @param left - The left segment (may contain ANSI).
 * @param right - The right segment (may contain ANSI).
 * @param width - Total visible width to fill (defaults to {@link RAIL_WIDTH}).
 * @returns The padded line.
 * @example
 * railLine("  ├─ ✓ pages", "· 12ms");
 */
function railLine(left: string, right: string, width = RAIL_WIDTH): string {
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  return `${left}${" ".repeat(gap)}${right}`;
}

/**
 * The runtime facts line shown under the banner: the pinned core version (when known)
 * plus the live Node/Bun versions + platform — the ACTUAL running runtime, not the
 * `engines` floor. Every value is real (read from `@moku-labs/core`'s pinned dependency
 * and `process.versions`), so nothing on this line is faked.
 *
 * @param coreVersion - The pinned `@moku-labs/core` version (appended last — it rarely
 *   matters — and omitted entirely when unknown).
 * @returns The facts string (e.g. `node 24.3.0 · bun 1.3.9 · darwin arm64 · core 0.1.0-alpha.6`).
 * @example
 * runtimeFacts("0.1.0-alpha.6");
 */
function runtimeFacts(coreVersion: string | undefined): string {
  const node = `node ${process.versions.node}`;
  const bun = process.versions.bun ? ` · bun ${process.versions.bun}` : "";
  const core = coreVersion ? ` · core ${coreVersion}` : "";
  return `${node}${bun} · ${process.platform} ${process.arch}${core}`;
}

/**
 * Create the Panel {@link CliRenderer}. Output is written through the injected sink
 * (default `console.log`/`console.error`) and colorized only when color is enabled, so
 * the identical render path yields the animated, box-free Velocity UI on a TTY and
 * plain ASCII lines in CI/pipes.
 *
 * @param options - Optional sinks, color/truecolor overrides, clock, and version (see
 *   {@link PanelOptions}).
 * @returns The renderer mounted on `state.render` and driven by the API + hooks.
 * @example
 * const render = createPanelRenderer({ version: "0.1.0-alpha" });
 * render.header("build");
 */
export function createPanelRenderer(options: PanelOptions = {}): CliRenderer {
  // biome-ignore lint/suspicious/noConsole: the Panel renderer writes to stdout (default sink); tests inject a capturing sink.
  const write = options.write ?? ((line: string) => console.log(line));
  const writeError = options.writeError ?? ((line: string) => console.error(line));
  const writeRaw =
    options.writeRaw ??
    ((chunk: string): void => {
      process.stdout.write(chunk);
    });
  const now = options.now ?? Date.now;
  const color = options.color ?? supportsColor();
  const truecolor = options.truecolor ?? (color && supportsTruecolor());
  const palette = makePalette(color, truecolor);
  const version = options.version ?? "dev";
  const coreVersion = options.coreVersion;
  const g = glyphSet(color);

  /** One row of the live in-place phase tree: a phase name, whether it has finished, and its duration. */
  type PhaseRow = { name: string; done: boolean; durationMs: number | undefined };

  // Live-render state (the in-place regions are exercised only when `color` is on — a TTY).
  let phaseRows: PhaseRow[] = [];
  let phaseDrawn = 0;
  let phaseOpen = false;
  let blockStartedAt = 0;
  let rebuilding = false;
  let rebuildLabel = "";
  let rebuildStartedAt = 0;
  let idle = false;
  let idleStartedAt = 0;
  let serveMode = false;
  let ticker: ReturnType<typeof setInterval> | undefined;

  /**
   * Render one phase-tree row: a spinning cyan glyph + dim name while running, or a green
   * `✓` + name with the duration right-aligned in the dim timing column once done.
   *
   * @param row - The phase row to render.
   * @returns The rendered row line (no trailing newline).
   * @example
   * renderPhaseRow({ name: "pages", done: true, durationMs: 12 });
   */
  const renderPhaseRow = (row: PhaseRow): string => {
    const branch = palette.dim(g.tree);
    if (row.done) {
      return railLine(
        `  ${branch} ${palette.green("✓")} ${row.name}`,
        palette.dim(`· ${row.durationMs}ms`)
      );
    }
    const spinner = palette.cyan(spinnerFrameAt(now() - blockStartedAt, SPIN_MS));
    return `  ${branch} ${spinner} ${palette.dim(row.name)}`;
  };

  /**
   * Render the indeterminate "comet" build bar — a short pink fill window sweeping across
   * a dim track — for the given elapsed time. Animated purely from wall-clock elapsed so
   * it never needs a known phase total.
   *
   * @param elapsedMs - Milliseconds since the phase block opened.
   * @returns The rendered bar row (no trailing newline).
   * @example
   * renderBuildBar(300);
   */
  const renderBuildBar = (elapsedMs: number): string => {
    const length = 28;
    const window = 6;
    const head = Math.floor(elapsedMs / 28) % (length + window);
    let bar = "";
    for (let index = 0; index < length; index++) {
      const lit = index <= head && index > head - window;
      bar += lit ? palette.pink(g.barFill) : palette.dim(g.barTrack);
    }
    return `     ${bar}`;
  };

  /**
   * Repaint the live phase block in place (tree rows + animated build bar): move up over
   * the prior draw, rewrite each row, then the bar, clearing any stale trailing lines.
   *
   * @example
   * paintPhaseBlock();
   */
  const paintPhaseBlock = (): void => {
    let frame = cursorUp(phaseDrawn);
    for (const row of phaseRows) frame += `${CLEAR_LINE}${renderPhaseRow(row)}\n`;
    frame += `${CLEAR_LINE}${renderBuildBar(now() - blockStartedAt)}\n`;
    writeRaw(frame + CLEAR_BELOW);
    phaseDrawn = phaseRows.length + 1;
  };

  /**
   * Repaint the single in-place rebuild line (spinner + label + live elapsed seconds).
   *
   * @example
   * paintRebuildLine();
   */
  const paintRebuildLine = (): void => {
    const spinner = palette.cyan(spinnerFrameAt(now() - rebuildStartedAt, SPIN_MS));
    const elapsed = palette.dim(`· ${((now() - rebuildStartedAt) / 1000).toFixed(1)}s`);
    writeRaw(`\r${CLEAR_LINE}  ${spinner} rebuilding ${rebuildLabel} ${elapsed}`);
  };

  /**
   * Repaint the persistent in-place `◍ live` idle pulse beneath the serve panel — the
   * dot breathes (pink → dim) on a calm ~0.6s cycle so a quiet dev session always reads
   * as alive without strobing.
   *
   * @example
   * paintIdleLine();
   */
  const paintIdleLine = (): void => {
    const lit = Math.floor((now() - idleStartedAt) / 450) % 2 === 0;
    const dot = lit ? palette.pink(g.liveOn) : palette.dim(g.liveOff);
    writeRaw(`\r${CLEAR_LINE}  ${dot} ${palette.dim("live · waiting for changes…")}`);
  };

  /**
   * Advance whichever live region is active by one frame (driven by the shared ticker).
   *
   * @example
   * onTick();
   */
  const onTick = (): void => {
    if (rebuilding) paintRebuildLine();
    else if (phaseOpen) paintPhaseBlock();
    else if (idle) paintIdleLine();
  };

  /**
   * Start the animation ticker (TTY only; idempotent; `unref`'d so it never blocks exit).
   *
   * @example
   * startTicker();
   */
  const startTicker = (): void => {
    if (!color || ticker) return;
    ticker = setInterval(onTick, TICK_MS);
    (ticker as { unref?: () => void }).unref?.();
  };

  /**
   * Stop the animation ticker if running.
   *
   * @example
   * stopTicker();
   */
  const stopTicker = (): void => {
    if (ticker) clearInterval(ticker);
    ticker = undefined;
  };

  /**
   * Write each line of a multi-line block through the stdout sink.
   *
   * @param lines - The rendered lines to write in order.
   * @example
   * writeBlock(["a", "b"]);
   */
  const writeBlock = (lines: string[]): void => {
    for (const line of lines) write(line);
  };

  /**
   * Resume the serve idle pulse on a fresh bottom line (TTY serve sessions only). A no-op
   * outside serve so standalone rebuild/error calls in unit tests never leave a ticker
   * running.
   *
   * @example
   * resumeIdle();
   */
  const resumeIdle = (): void => {
    if (!(color && serveMode)) {
      stopTicker();
      return;
    }
    idle = true;
    idleStartedAt = now();
    paintIdleLine();
    startTicker();
  };

  return {
    /**
     * Render the `▟▙ moku web` lockup + per-command label, a dim rule, and the runtime
     * facts line (live Node/Bun versions + platform). Called once per command (one
     * command = one process), so it never repeats within a run.
     *
     * @param command - The command being run, shown beside the wordmark.
     * @example
     * render.header("serve");
     */
    header(command) {
      const cube = palette.pink(g.cube);
      const wordmark = palette.pink(palette.bold("moku web"));
      const label = palette.dim(COMMAND_LABEL[command]);
      writeBlock([
        railLine(` ${cube} ${wordmark}  ${label}`, palette.dim(version)),
        ` ${palette.dim(g.rule.repeat(RAIL_WIDTH - 1))}`,
        ` ${palette.dim(runtimeFacts(coreVersion))}`
      ]);
    },

    /**
     * Render a live per-phase row from a `build:phase` event. On a TTY each phase is ONE
     * tree row that updates in place (spinning glyph while running → green ✓ + duration
     * when done) beneath an animated indeterminate build bar; off a TTY one line is
     * printed per completed phase (no start/done duplication). A no-op while a serve()
     * rebuild is in flight — those show the compact rebuild line.
     *
     * @param phase - The `build:phase` payload.
     * @example
     * render.phase({ phase: "pages", status: "done", durationMs: 12 });
     */
    phase(phase) {
      // Suppressed during a rebuild: the compact rebuild line stands in for the phase tree.
      if (rebuilding) return;

      // Plain/CI: emit one line per completed phase (skip the "start" row — no duplication).
      if (!color) {
        if (phase.status === "done") {
          write(
            `  ${palette.green("✓")} ${phase.phase}${durationSuffix(palette, phase.durationMs)}`
          );
        }
        return;
      }

      // TTY: update the live in-place phase tree, opening a fresh one for a new build.
      if (!phaseOpen) {
        phaseRows = [];
        phaseDrawn = 0;
        phaseOpen = true;
        blockStartedAt = now();
      }
      const done = phase.status === "done";
      const existing = phaseRows.find(row => row.name === phase.phase);
      if (existing) {
        existing.done = done;
        existing.durationMs = phase.durationMs;
      } else {
        phaseRows.push({ name: phase.phase, done, durationMs: phase.durationMs });
      }
      paintPhaseBlock();
      startTicker();
    },

    /**
     * Render the BUILD summary line + a one-shot throughput sparkline from a
     * `build:complete` event, finalizing the live phase tree (dropping its animated bar)
     * first.
     *
     * @param summary - The `build:complete` payload.
     * @example
     * render.built({ outDir: "dist", pageCount: 12, durationMs: 840 });
     */
    built(summary) {
      // Suppressed during a rebuild: a rebuild settles with the compact reload line.
      if (rebuilding) return;

      // Finalize the live tree (repaint rows only — no trailing build bar) before the summary.
      if (color && phaseOpen) {
        let frame = cursorUp(phaseDrawn);
        for (const row of phaseRows) frame += `${CLEAR_LINE}${renderPhaseRow(row)}\n`;
        writeRaw(frame + CLEAR_BELOW);
      }
      // Capture the real per-phase durations BEFORE resetting (color/TTY only — plain mode
      // never populates the tree), for the time-profile sparkline in the summary box.
      const phaseDurations = phaseRows
        .map(row => row.durationMs)
        .filter((value): value is number => value !== undefined);
      phaseOpen = false;
      phaseDrawn = 0;
      stopTicker();

      // Full-width box (right edge aligns with the phase tree), laid out airily: the
      // result + page count on the left, the timing + out dir pushed to the right edge.
      const pages = palette.bold(String(summary.pageCount));
      const dot = palette.dim("·");
      const left = `${palette.green("✓")} ${palette.bold("BUILD")} ${dot} ${pages} pages`;
      const right = `${summary.durationMs}ms ${dot} ${summary.outDir}/`;
      const lines = [railLine(left, right, BOX_INNER)];
      if (color && summary.durationMs > 0) {
        const rate = Math.max(1, Math.round(summary.pageCount / (summary.durationMs / 1000)));
        const spark = phaseDurations.length > 0 ? palette.pink(sparkline(phaseDurations)) : "";
        const rateLabel = palette.dim(`${rate} pages/s`);
        lines.push(railLine(spark, rateLabel, BOX_INNER));
      }
      // Sits directly under the tree (no top margin), one blank line below to set off the panel.
      writeBlock(box(lines, color, BOX_INNER));
      write("");
    },

    /**
     * Render the server-ready rail (Local / Network URLs + watched dirs) and, on a TTY,
     * begin the persistent breathing `◍ live` idle pulse beneath it.
     *
     * @param info - Local/Network URLs and optionally the watched directories.
     * @example
     * render.serverReady({ local: "http://localhost:4173", network: null });
     */
    serverReady(info) {
      const network = info.network ? palette.cyan(info.network) : palette.dim("unavailable");
      const lines = [
        `${palette.green("➜")} ${palette.bold("Local")}    ${palette.cyan(info.local)}`,
        `${palette.green("➜")} ${palette.bold("Network")}  ${network}`
      ];
      if (info.watching && info.watching.length > 0) {
        lines.push(`${palette.dim("watching")}   ${palette.dim(info.watching.join(", "))}`);
      }
      // Full-width box (matches the BUILD panel), one blank line below before the idle pulse.
      writeBlock(box(lines, color, BOX_INNER));
      write("");

      // TTY: drop the persistent idle pulse on its own bottom line and animate it.
      if (color) {
        serveMode = true;
        idle = true;
        idleStartedAt = now();
        paintIdleLine();
        startTicker();
      }
    },

    /**
     * Begin a serve() rebuild: show ONE compact "rebuilding {label}" line (an animated
     * spinner with live elapsed on a TTY; a plain "~ {label}" line otherwise), taking over
     * the idle-pulse line, and mute the verbose phase tree + BUILD summary until
     * {@link reload}/{@link error} settles it.
     *
     * @param label - The changed watch target shown in the line.
     * @example
     * render.rebuildStart("content");
     */
    rebuildStart(label) {
      rebuilding = true;
      idle = false;
      rebuildLabel = label;
      rebuildStartedAt = now();

      // Plain/CI: a single "~ label" line; the result line follows from reload().
      if (!color) {
        write(`  ${palette.yellow("~")} ${label}`);
        return;
      }

      // TTY: draw the spinner line in place and animate it until the rebuild settles.
      paintRebuildLine();
      startTicker();
    },

    /**
     * Settle the current rebuild: replace the in-place "rebuilding…" line with a compact
     * "✓ rebuilt N pages · Xms · reloaded", then (in a serve session) resume the idle pulse
     * on a fresh bottom line. Called standalone (no preceding {@link rebuildStart}) it also
     * prints the "~ file" line so the changed target stays visible.
     *
     * @param info - The changed file plus the rebuild's page count and duration.
     * @example
     * render.reload({ file: "content/a.md", pageCount: 12, durationMs: 84 });
     */
    reload(info) {
      const settledRebuild = rebuilding;
      rebuilding = false;

      const mark = palette.green("✓");
      const count = palette.bold(String(info.pageCount));
      const meta = palette.dim(`· ${info.durationMs}ms · reloaded`);
      const line = `  ${mark} rebuilt ${count} pages ${meta}`;

      // TTY: overwrite the animated spinner line in place with the result, then resume idle.
      if (settledRebuild && color) {
        writeRaw(`\r${CLEAR_LINE}${line}\n`);
        resumeIdle();
        return;
      }
      // Standalone reload(): surface the changed target (rebuildStart already did so in
      // the plain serve flow, so only add it when no rebuildStart preceded this call).
      if (!settledRebuild) write(`  ${palette.yellow("~")} ${info.file}`);
      write(line);
    },

    /**
     * Render the deploy result from a `deploy:complete` event: a `✓ DEPLOYED → url` line
     * with the URL the hero value, then a dim `branch · id · time` line beneath it.
     *
     * @param result - The `deploy:complete` payload.
     * @example
     * render.deployed({ url: "https://x.pages.dev", deploymentId: "id", branch: "main", durationMs: 1200 });
     */
    deployed(result) {
      const meta = palette.dim(
        `branch ${result.branch} · ${result.deploymentId} · ${result.durationMs}ms`
      );
      writeBlock([
        `  ${palette.green("✓")} ${palette.bold("DEPLOYED")}   ${palette.dim("→")}  ${palette.cyan(result.url)}`,
        `  ${meta}`
      ]);
    },

    /**
     * Render a neutral informational line.
     *
     * @param message - The line to print.
     * @example
     * render.info("watching for changes…");
     */
    info(message) {
      const [first = "", ...rest] = message.split("\n");
      write(`  ${palette.cyan("›")} ${first}`);
      for (const line of rest) write(`    ${line}`);
    },

    /**
     * Render a warning line (to stderr).
     *
     * @param message - The warning to print.
     * @example
     * render.warn("deploy skipped");
     */
    warn(message) {
      writeError(`  ${palette.yellow("⚠")} ${message}`);
    },

    /**
     * Render an error line (to stderr), optionally with a cause. A failing rebuild settles
     * its in-place spinner line first; in a serve session the idle pulse then resumes.
     *
     * @param message - The error summary to print.
     * @param cause - Optional underlying error/value to print beneath the summary.
     * @example
     * render.error("build failed", err);
     */
    error(message, cause) {
      const wasRebuilding = rebuilding;
      if (rebuilding) {
        rebuilding = false;
        if (color) writeRaw(`\r${CLEAR_LINE}`);
      }
      writeError(`  ${palette.red("✗")} ${message}`);
      if (cause !== undefined) writeError(String(cause));
      if (wasRebuilding) resumeIdle();
      else stopTicker();
    },

    /**
     * Render a section heading (a blank line + a bold pink label) for a multi-step flow.
     *
     * @param text - The heading label.
     * @example
     * render.heading("Diagnostics");
     */
    heading(text) {
      write("");
      write(`  ${palette.bold(palette.pink(text))}`);
    },

    /**
     * Render a diagnostic line: green `✓` (pass) or red `✗` (fail) + label, with optional
     * dim, indented detail beneath (e.g. a fix hint for a failing check).
     *
     * @param ok - Whether the check passed.
     * @param label - The check label.
     * @param detail - Optional multi-line guidance shown indented under the line.
     * @example
     * render.check(false, "CLOUDFLARE_API_TOKEN is set", "Create one at …");
     */
    check(ok, label, detail) {
      write(`  ${ok ? palette.green("✓") : palette.red("✗")} ${label}`);
      if (detail !== undefined) {
        for (const line of detail.split("\n")) write(`      ${palette.dim(line)}`);
      }
    },

    /**
     * Stop every animation and release the interval timer (serve()'s teardown calls this).
     *
     * @example
     * render.dispose();
     */
    dispose() {
      stopTicker();
      idle = false;
      rebuilding = false;
      phaseOpen = false;
      serveMode = false;
    }
  };
}
