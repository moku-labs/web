/**
 * @file cli plugin — the Panel renderer. Produces the boxed `MOKU WEB` header, live
 * phase rows, the BUILD summary block, the bordered server-ready panel, reload
 * lines, and the deploy panel. TTY/`NO_COLOR`-aware via {@link makePalette}; lines
 * are written through an injectable sink so tests can capture them.
 */
import type { CliRenderer, Command } from "../types";
import { box, makePalette, type Palette, supportsColor } from "./ansi";

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
  const color = options.color ?? supportsColor();
  const palette = makePalette(color);

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
     * Render a live per-phase row from a `build:phase` event.
     *
     * @param phase - The `build:phase` payload.
     * @example
     * render.phase({ phase: "pages", status: "done", durationMs: 12 });
     */
    phase(phase) {
      const done = phase.status === "done";
      const mark = done ? palette.green("✓") : palette.dim("•");
      const name = done ? phase.phase : palette.dim(phase.phase);
      write(`  ${mark} ${name}${durationSuffix(palette, phase.durationMs)}`);
    },

    /**
     * Render the BUILD summary block from a `build:complete` event.
     *
     * @param summary - The `build:complete` payload.
     * @example
     * render.built({ outDir: "dist", pageCount: 12, durationMs: 840 });
     */
    built(summary) {
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
     * Render the post-rebuild line ("~ file" + "✓ rebuilt N pages · Xms · reloaded").
     *
     * @param info - The changed file plus the rebuild's page count and duration.
     * @example
     * render.reload({ file: "content/a.md", pageCount: 12, durationMs: 84 });
     */
    reload(info) {
      write(`  ${palette.yellow("~")} ${info.file}`);
      const mark = palette.green("✓");
      const count = palette.bold(String(info.pageCount));
      const meta = palette.dim(`· ${info.durationMs}ms · browser reloaded`);
      write(`  ${mark} rebuilt ${count} pages ${meta}`);
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
      writeError(`  ${palette.red("✗")} ${message}`);
      if (cause !== undefined) writeError(String(cause));
    }
  };
}
