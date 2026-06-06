/**
 * @file cli plugin — the Panel renderer. Produces the boxed `MOKU WEB` header, live
 * phase rows, the BUILD summary block, the bordered server-ready panel, reload
 * lines, and the deploy panel. TTY/`NO_COLOR`-aware via {@link makePalette}; lines
 * are written through an injectable sink so tests can capture them.
 */
import type { CliRenderer, Command } from "../types";
import {
  box,
  CLEAR_BELOW,
  CLEAR_LINE,
  cursorUp,
  makePalette,
  type Palette,
  SPINNER_FRAMES,
  supportsColor
} from "./ansi";

/**
 * Options for {@link createPanelRenderer}. All optional: the defaults wire the
 * renderer to `console.log`/`console.error` with auto-detected color, while tests
 * inject a capturing sink and force `color: false` for deterministic plain output.
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
  /**
   * Raw stdout sink that writes a chunk WITHOUT an implicit newline — used for the
   * in-place, cursor-controlled live rendering (phase block + rebuild spinner) that runs
   * only when `color` is on. Defaults to `process.stdout.write`; tests inject a capture.
   */
  writeRaw?: (chunk: string) => void;
  /** Monotonic clock (ms) for the rebuild spinner's elapsed counter. Defaults to `Date.now`. */
  now?: () => number;
};

/** Per-command label shown in the header badge beside the logo. */
const COMMAND_LABEL: Record<Command, string> = {
  build: "build",
  serve: "serve · dev",
  preview: "preview",
  deploy: "deploy"
};

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
 * Create the Panel {@link CliRenderer}. Output is written through the injected sink
 * (default `console.log`/`console.error`) and colorized only when color is enabled,
 * so the identical render path yields box-drawn color panels on a TTY and plain
 * ASCII lines in CI/pipes.
 *
 * @param options - Optional sinks + a color override (see {@link PanelOptions}).
 * @returns The renderer mounted on `state.render` and driven by the API + hooks.
 * @example
 * const render = createPanelRenderer();
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
  const palette = makePalette(color);

  /**
   * One row of the live in-place phase block: a phase name, whether it has finished, and
   * its duration once known.
   */
  type PhaseRow = { name: string; done: boolean; durationMs: number | undefined };

  // Live-render state (only exercised when `color` is on — a TTY). The phase block is the
  // initial build's in-place phase list; the rebuild line is serve()'s compact spinner.
  let phaseRows: PhaseRow[] = [];
  let phaseDrawn = 0;
  let phaseOpen = false;
  let rebuilding = false;
  let rebuildLabel = "";
  let rebuildStartedAt = 0;
  let spinnerFrame = 0;
  let ticker: ReturnType<typeof setInterval> | undefined;

  /**
   * The current spinner glyph (with a static fallback under `noUncheckedIndexedAccess`).
   *
   * @returns The active braille spinner frame.
   * @example
   * frameGlyph(); // "⠙"
   */
  const frameGlyph = (): string => SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? "⠋";

  /**
   * Render one phase row: a green `✓ name · time` when done, else a spinning cyan glyph
   * before the dim name.
   *
   * @param row - The phase row to render.
   * @returns The rendered row line (no trailing newline).
   * @example
   * renderPhaseRow({ name: "pages", done: true, durationMs: 12 });
   */
  const renderPhaseRow = (row: PhaseRow): string => {
    if (row.done)
      return `  ${palette.green("✓")} ${row.name}${durationSuffix(palette, row.durationMs)}`;
    return `  ${palette.cyan(frameGlyph())} ${palette.dim(row.name)}`;
  };

  /**
   * Repaint the live phase block in place: move up over the prior draw, then rewrite each
   * row (clearing any stale trailing lines).
   *
   * @example
   * paintPhaseBlock();
   */
  const paintPhaseBlock = (): void => {
    let frame = cursorUp(phaseDrawn);
    for (const row of phaseRows) frame += `${CLEAR_LINE}${renderPhaseRow(row)}\n`;
    writeRaw(frame + CLEAR_BELOW);
    phaseDrawn = phaseRows.length;
  };

  /**
   * Repaint the single in-place rebuild line (spinner + label + live elapsed seconds).
   *
   * @example
   * paintRebuildLine();
   */
  const paintRebuildLine = (): void => {
    const elapsed = ((now() - rebuildStartedAt) / 1000).toFixed(1);
    const meta = palette.dim(`· ${elapsed}s`);
    writeRaw(`\r${CLEAR_LINE}  ${palette.cyan(frameGlyph())} rebuilding ${rebuildLabel} ${meta}`);
  };

  /**
   * Advance the spinner one frame and repaint whichever live region is active.
   *
   * @example
   * onTick();
   */
  const onTick = (): void => {
    spinnerFrame += 1;
    if (rebuilding) paintRebuildLine();
    else if (phaseOpen) paintPhaseBlock();
  };

  /**
   * Start the animation ticker (TTY only; idempotent; `unref`'d so it never blocks exit).
   *
   * @example
   * startTicker();
   */
  const startTicker = (): void => {
    if (!color || ticker) return;
    ticker = setInterval(onTick, 80);
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

  return {
    /**
     * Render the boxed `MOKU WEB` logo + command label.
     *
     * @param command - The command being run, shown beside the logo.
     * @example
     * render.header("serve");
     */
    header(command) {
      const logo = palette.bold(palette.cyan("MOKU WEB"));
      const label = palette.dim(COMMAND_LABEL[command]);
      writeBlock(box([`${logo}  ${label}`], color));
    },

    /**
     * Render a per-phase row from a `build:phase` event. On a TTY each phase is ONE row
     * that updates in place (spinning glyph while running → green ✓ + duration when done);
     * off a TTY one line is printed per completed phase (no start/done duplication). A
     * no-op while a serve() rebuild is in flight — those show the compact rebuild line.
     *
     * @param phase - The `build:phase` payload.
     * @example
     * render.phase({ phase: "pages", status: "done", durationMs: 12 });
     */
    phase(phase) {
      // Suppressed during a rebuild: the compact rebuild line stands in for the phase list.
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

      // TTY: update the live in-place phase block, opening a fresh one for a new build.
      if (!phaseOpen) {
        phaseRows = [];
        phaseDrawn = 0;
        phaseOpen = true;
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
     * Render the BUILD summary block from a `build:complete` event.
     *
     * @param summary - The `build:complete` payload.
     * @example
     * render.built({ outDir: "dist", pageCount: 12, durationMs: 840 });
     */
    built(summary) {
      // Suppressed during a rebuild: a rebuild settles with the compact reload line, not
      // the full BUILD box (which otherwise reprinted the whole build log every keystroke).
      if (rebuilding) return;

      // Finalize the live phase block (all rows are done by now) before the summary box.
      phaseOpen = false;
      phaseDrawn = 0;
      stopTicker();

      const pages = palette.bold(String(summary.pageCount));
      writeBlock(
        box(
          [
            `${palette.green("✓")} ${palette.bold("BUILD")} complete`,
            `${palette.dim("pages")}   ${pages}`,
            `${palette.dim("time")}    ${summary.durationMs}ms`,
            `${palette.dim("out")}     ${summary.outDir}/`
          ],
          color
        )
      );
    },

    /**
     * Render the bordered server-ready panel (Local / Network URLs + watched dirs).
     *
     * @param info - Local/Network URLs and optionally the watched directories.
     * @example
     * render.serverReady({ local: "http://localhost:4173", network: null });
     */
    serverReady(info) {
      const lines = [
        `${palette.green("➜")} ${palette.bold("Local")}    ${palette.cyan(info.local)}`,
        `${palette.green("➜")} ${palette.bold("Network")}  ${
          info.network ? palette.cyan(info.network) : palette.dim("unavailable")
        }`
      ];
      if (info.watching && info.watching.length > 0) {
        lines.push(`${palette.dim("watching")} ${palette.dim(info.watching.join(", "))}`);
      }
      writeBlock(box(lines, color));
    },

    /**
     * Begin a serve() rebuild: show ONE compact "rebuilding {label}" line (an animated
     * spinner with live elapsed on a TTY; a plain "~ {label}" line otherwise) and mute
     * the verbose phase rows + BUILD box until {@link reload}/{@link error} settles it.
     *
     * @param label - The changed watch target shown in the line.
     * @example
     * render.rebuildStart("content");
     */
    rebuildStart(label) {
      rebuilding = true;
      rebuildLabel = label;
      rebuildStartedAt = now();
      spinnerFrame = 0;

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
     * "✓ rebuilt N pages · Xms · reloaded" (on a TTY) and re-enable verbose build output.
     * Called standalone (no preceding {@link rebuildStart}) it also prints the "~ file"
     * line so the changed target stays visible.
     *
     * @param info - The changed file plus the rebuild's page count and duration.
     * @example
     * render.reload({ file: "content/a.md", pageCount: 12, durationMs: 84 });
     */
    reload(info) {
      const settledRebuild = rebuilding;
      rebuilding = false;
      stopTicker();

      const mark = palette.green("✓");
      const count = palette.bold(String(info.pageCount));
      const meta = palette.dim(`· ${info.durationMs}ms · reloaded`);
      const line = `  ${mark} rebuilt ${count} pages ${meta}`;

      // TTY: overwrite the animated spinner line in place with the result.
      if (settledRebuild && color) {
        writeRaw(`\r${CLEAR_LINE}${line}\n`);
        return;
      }
      // Standalone reload(): surface the changed target (rebuildStart already did so in
      // the plain serve flow, so only add it when no rebuildStart preceded this call).
      if (!settledRebuild) write(`  ${palette.yellow("~")} ${info.file}`);
      write(line);
    },

    /**
     * Render the deploy result panel from a `deploy:complete` event.
     *
     * @param result - The `deploy:complete` payload.
     * @example
     * render.deployed({ url: "https://x.pages.dev", deploymentId: "id", branch: "main", durationMs: 1200 });
     */
    deployed(result) {
      writeBlock(
        box(
          [
            `${palette.green("✓")} ${palette.bold("DEPLOYED")}`,
            `${palette.dim("url")}     ${palette.cyan(result.url)}`,
            `${palette.dim("branch")}  ${result.branch}`,
            `${palette.dim("id")}      ${result.deploymentId}`,
            `${palette.dim("time")}    ${result.durationMs}ms`
          ],
          color
        )
      );
    },

    /**
     * Render a neutral informational line.
     *
     * @param message - The line to print.
     * @example
     * render.info("watching for changes…");
     */
    info(message) {
      write(`  ${palette.cyan("›")} ${message}`);
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
     * Render an error line (to stderr), optionally with a cause.
     *
     * @param message - The error summary to print.
     * @param cause - Optional underlying error/value to print beneath the summary.
     * @example
     * render.error("build failed", err);
     */
    error(message, cause) {
      // A failing rebuild settles its in-place spinner line first, then prints the error.
      if (rebuilding) {
        rebuilding = false;
        stopTicker();
        if (color) writeRaw(`\r${CLEAR_LINE}`);
      }
      writeError(`  ${palette.red("✗")} ${message}`);
      if (cause !== undefined) writeError(String(cause));
    }
  };
}
