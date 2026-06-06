/**
 * @file cli plugin — TTY/NO_COLOR-aware ANSI color + box-drawing helpers shared by
 * the Panel renderer. Modeled on the legacy `scripts/_log.ts`: color and box glyphs
 * are emitted only on a real TTY with `NO_COLOR` unset; otherwise plain ASCII so
 * CI logs and pipes stay readable.
 */

/** The ANSI escape byte (ESC, `0x1b`), built so no literal control char is in source. */
const ESC = String.fromCodePoint(0x1b);

/** ANSI SGR codes used by the Panel renderer (each prefixed with the ESC byte). */
export const ANSI = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  magenta: `${ESC}[35m`,
  cyan: `${ESC}[36m`,
  gray: `${ESC}[90m`
} as const;

/** A single ANSI color code from {@link ANSI}. */
export type AnsiCode = (typeof ANSI)[keyof typeof ANSI];

/** ANSI: erase the entire current line, leaving the cursor where it is. */
export const CLEAR_LINE = `${ESC}[2K`;
/** ANSI: erase from the cursor to the end of the screen (drops stale trailing rows). */
export const CLEAR_BELOW = `${ESC}[0J`;

/**
 * Braille spinner frames for live "working…" indicators on a TTY (advance one per tick).
 * Off a TTY the Panel never animates, so this is unused in plain/CI output.
 */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/**
 * The ANSI sequence to move the cursor up `n` lines (empty string for `n <= 0`). The
 * Panel uses it to repaint a live block in place — move up over the previous draw, then
 * rewrite each row — so progress updates a fixed region instead of scrolling new lines.
 *
 * @param n - Number of lines to move the cursor up.
 * @returns The cursor-up escape sequence, or `""` when `n <= 0`.
 * @example
 * cursorUp(3); // "\x1b[3A"
 */
export function cursorUp(n: number): string {
  return n > 0 ? `${ESC}[${n}A` : "";
}

/**
 * Box-drawing glyphs used to frame panels (Unicode on a TTY, ASCII fallback off it).
 *
 * @example
 * const glyphs = boxGlyphs(true);
 */
export type BoxGlyphs = {
  /** Top-left corner. */
  topLeft: string;
  /** Top-right corner. */
  topRight: string;
  /** Bottom-left corner. */
  bottomLeft: string;
  /** Bottom-right corner. */
  bottomRight: string;
  /** Horizontal edge. */
  horizontal: string;
  /** Vertical edge. */
  vertical: string;
};

/** Unicode rounded box glyphs used when output is a color-capable TTY. */
const UNICODE_BOX: BoxGlyphs = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│"
};

/** ASCII box glyphs used when output is piped/CI (plain mode). */
const ASCII_BOX: BoxGlyphs = {
  topLeft: "+",
  topRight: "+",
  bottomLeft: "+",
  bottomRight: "+",
  horizontal: "-",
  vertical: "|"
};

/**
 * Matches every ANSI SGR escape sequence (used to measure visible width). Built from
 * the {@link ESC} byte so no literal control character appears in the source regex.
 */
const ANSI_PATTERN = new RegExp(String.raw`${ESC}\[[0-9;]*m`, "g");

/**
 * The minimal stream shape {@link supportsColor} probes — just the `isTTY` flag.
 *
 * @example
 * const stream: ColorStream = { isTTY: true };
 */
export type ColorStream = {
  /** Whether the stream is a TTY (color-capable). */
  isTTY?: boolean;
};

/**
 * Whether ANSI color/box glyphs should be emitted: a TTY stream with `NO_COLOR`
 * unset. Reads `process.stdout.isTTY` and `process.env.NO_COLOR` by default so the
 * renderer auto-degrades in CI and pipes, exactly like the legacy logger.
 *
 * @param stream - Stream to probe for `isTTY` (defaults to `process.stdout`).
 * @param noColor - The `NO_COLOR` value (defaults to `process.env.NO_COLOR`).
 * @returns `true` when color should be used.
 * @example
 * supportsColor(); // true in an interactive terminal
 */
export function supportsColor(
  stream: ColorStream = process.stdout,
  noColor: string | undefined = process.env.NO_COLOR
): boolean {
  const isColorCapable = stream.isTTY === true && noColor === undefined;
  return isColorCapable;
}

/**
 * Select the box glyph set for the given color mode (Unicode on a TTY, ASCII off it).
 *
 * @param color - Whether color/Unicode output is enabled.
 * @returns The matching {@link BoxGlyphs} set.
 * @example
 * const glyphs = boxGlyphs(supportsColor());
 */
export function boxGlyphs(color: boolean): BoxGlyphs {
  return color ? UNICODE_BOX : ASCII_BOX;
}

/**
 * The visible width of a string, ignoring any ANSI escape sequences it contains.
 *
 * @param text - The (possibly colorized) text to measure.
 * @returns The number of visible characters.
 * @example
 * visibleWidth(`${ANSI.red}hi${ANSI.reset}`); // 2
 */
export function visibleWidth(text: string): number {
  return text.replaceAll(ANSI_PATTERN, "").length;
}

/**
 * A color palette bound to a fixed color mode. `paint` wraps text in an ANSI code
 * when enabled (no-op in plain mode); the named accessors are thin sugar over it.
 *
 * @example
 * const palette = makePalette(true);
 * palette.green("ok");
 */
export type Palette = {
  /** Whether this palette emits color. */
  readonly enabled: boolean;
  /**
   * Wrap text in the given ANSI code (returns it unchanged in plain mode).
   *
   * @param code - The ANSI SGR code to apply.
   * @param text - The text to colorize.
   * @returns The colorized (or unchanged) text.
   * @example
   * palette.paint(ANSI.green, "ok");
   */
  paint(code: AnsiCode, text: string): string;
  /**
   * Bold the given text (no-op in plain mode).
   *
   * @param text - The text to embolden.
   * @returns The bold (or unchanged) text.
   * @example
   * palette.bold("title");
   */
  bold(text: string): string;
  /**
   * Dim the given text (no-op in plain mode).
   *
   * @param text - The text to dim.
   * @returns The dim (or unchanged) text.
   * @example
   * palette.dim("· 84ms");
   */
  dim(text: string): string;
  /**
   * Color the given text green (no-op in plain mode).
   *
   * @param text - The text to colorize.
   * @returns The green (or unchanged) text.
   * @example
   * palette.green("✓");
   */
  green(text: string): string;
  /**
   * Color the given text yellow (no-op in plain mode).
   *
   * @param text - The text to colorize.
   * @returns The yellow (or unchanged) text.
   * @example
   * palette.yellow("~");
   */
  yellow(text: string): string;
  /**
   * Color the given text red (no-op in plain mode).
   *
   * @param text - The text to colorize.
   * @returns The red (or unchanged) text.
   * @example
   * palette.red("✗");
   */
  red(text: string): string;
  /**
   * Color the given text cyan (no-op in plain mode).
   *
   * @param text - The text to colorize.
   * @returns The cyan (or unchanged) text.
   * @example
   * palette.cyan("http://localhost:4173");
   */
  cyan(text: string): string;
};

/**
 * Build a {@link Palette} bound to a fixed color mode. When `color` is `false` every
 * helper returns its input unchanged, so the same render code path produces plain
 * output in CI/pipes.
 *
 * @param color - Whether color is enabled (typically `supportsColor()`).
 * @returns The bound color palette.
 * @example
 * const palette = makePalette(supportsColor());
 * const line = palette.green("done");
 */
export function makePalette(color: boolean): Palette {
  return {
    enabled: color,
    /**
     * Wrap text in the given ANSI code (returns it unchanged when color is off).
     *
     * @param code - The ANSI SGR code to apply.
     * @param text - The text to colorize.
     * @returns The colorized (or unchanged) text.
     * @example
     * palette.paint(ANSI.green, "ok");
     */
    paint(code, text) {
      return color ? `${code}${text}${ANSI.reset}` : text;
    },
    /**
     * Bold the given text (no-op in plain mode).
     *
     * @param text - The text to embolden.
     * @returns The bold (or unchanged) text.
     * @example
     * palette.bold("title");
     */
    bold(text) {
      return this.paint(ANSI.bold, text);
    },
    /**
     * Dim the given text (no-op in plain mode).
     *
     * @param text - The text to dim.
     * @returns The dim (or unchanged) text.
     * @example
     * palette.dim("· 84ms");
     */
    dim(text) {
      return this.paint(ANSI.dim, text);
    },
    /**
     * Color the given text green (no-op in plain mode).
     *
     * @param text - The text to colorize.
     * @returns The green (or unchanged) text.
     * @example
     * palette.green("✓");
     */
    green(text) {
      return this.paint(ANSI.green, text);
    },
    /**
     * Color the given text yellow (no-op in plain mode).
     *
     * @param text - The text to colorize.
     * @returns The yellow (or unchanged) text.
     * @example
     * palette.yellow("~");
     */
    yellow(text) {
      return this.paint(ANSI.yellow, text);
    },
    /**
     * Color the given text red (no-op in plain mode).
     *
     * @param text - The text to colorize.
     * @returns The red (or unchanged) text.
     * @example
     * palette.red("✗");
     */
    red(text) {
      return this.paint(ANSI.red, text);
    },
    /**
     * Color the given text cyan (no-op in plain mode).
     *
     * @param text - The text to colorize.
     * @returns The cyan (or unchanged) text.
     * @example
     * palette.cyan("http://localhost:4173");
     */
    cyan(text) {
      return this.paint(ANSI.cyan, text);
    }
  };
}

/**
 * Frame a list of already-rendered content lines in a box, padding each line to the
 * width of the widest visible line. Uses Unicode borders when `color` is enabled and
 * ASCII otherwise. Visible width ignores embedded ANSI so colored lines align.
 *
 * @param lines - The content lines (may contain ANSI color codes).
 * @param color - Whether to use Unicode borders (and assume color-capable output).
 * @returns The boxed lines (top border, content rows, bottom border).
 * @example
 * box(["Local:   http://localhost:4173"], true);
 */
export function box(lines: string[], color: boolean): string[] {
  const glyphs = boxGlyphs(color);
  const inner = Math.max(0, ...lines.map(line => visibleWidth(line)));
  const horizontal = glyphs.horizontal.repeat(inner + 2);
  const top = `${glyphs.topLeft}${horizontal}${glyphs.topRight}`;
  const bottom = `${glyphs.bottomLeft}${horizontal}${glyphs.bottomRight}`;
  const rows = lines.map(line => {
    const pad = " ".repeat(inner - visibleWidth(line));
    return `${glyphs.vertical} ${line}${pad} ${glyphs.vertical}`;
  });
  return [top, ...rows, bottom];
}
