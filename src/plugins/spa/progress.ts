/**
 * @file spa plugin — in-house NProgress-style top progress bar (no nprogress dep).
 * @see README.md
 */

/** Control surface for the in-house progress bar. */
export interface ProgressBar {
  /**
   * Start the bar (after a 150ms delay) and begin trickling.
   *
   * @example
   * bar.start();
   */
  start(): void;
  /**
   * Complete and hide the bar.
   *
   * @example
   * bar.done();
   */
  done(): void;
}

/** Delay before the bar appears, so fast navigations show no indicator. */
const START_DELAY_MS = 150;
/** Interval between trickle increments while loading. */
const TRICKLE_MS = 300;
/** Linger before the completed bar is reset/hidden. */
const DONE_LINGER_MS = 200;
/** Ceiling the bar trickles to while still loading (never reaches 100% until done). */
const TRICKLE_CEIL = 90;

/** No-op progress bar used when disabled or in a headless context. */
const NOOP_BAR: ProgressBar = {
  // eslint-disable-next-line jsdoc/require-jsdoc -- no-op shell; behaviour documented on ProgressBar
  start() {},
  // eslint-disable-next-line jsdoc/require-jsdoc -- no-op shell; behaviour documented on ProgressBar
  done() {}
};

/**
 * Creates the in-house progress bar (150ms delay + trickle). A no-op shell when
 * progress is disabled or no DOM is present. The progress element is created
 * once (prepended to `<body>` as `<div data-progress>`) and reused across navs.
 *
 * @param enabled - Whether the progress bar is active.
 * @returns A {@link ProgressBar} with `start`/`done`. Disabled/headless → no-ops.
 * @example
 * const bar = createProgressBar(true);
 * bar.start();
 * bar.done();
 */
export function createProgressBar(enabled: boolean): ProgressBar {
  if (!enabled || typeof document === "undefined") return NOOP_BAR;

  const element = document.createElement("div");
  element.dataset.progress = "";
  document.body.prepend(element);

  let delayTimer: ReturnType<typeof setTimeout> | undefined;
  let trickleTimer: ReturnType<typeof setTimeout> | undefined;
  let width = 0;

  /**
   * Step the trickle upward toward the ceiling and reschedule.
   *
   * @example
   * trickle();
   */
  const trickle = (): void => {
    if (width >= TRICKLE_CEIL) return;
    // eslint-disable-next-line sonarjs/pseudo-random -- cosmetic progress jitter; not security-sensitive
    width = Math.min(TRICKLE_CEIL, width + 5 + Math.random() * 10);
    element.style.width = `${String(width)}%`;
    trickleTimer = setTimeout(trickle, TRICKLE_MS);
  };

  /**
   * Show the bar after the start delay and begin trickling.
   *
   * @example
   * start();
   */
  const start = (): void => {
    delayTimer = setTimeout(() => {
      width = 15;
      element.style.width = "15%";
      element.dataset.active = "";
      trickle();
    }, START_DELAY_MS);
  };

  /**
   * Complete the bar to 100%, then reset/hide it after a short linger.
   *
   * @example
   * done();
   */
  const done = (): void => {
    clearTimeout(delayTimer);
    clearTimeout(trickleTimer);
    element.style.width = "100%";
    element.dataset.active = "";
    setTimeout(() => {
      delete element.dataset.active;
      element.style.width = "0%";
      width = 0;
    }, DONE_LINGER_MS);
  };

  return { start, done };
}
