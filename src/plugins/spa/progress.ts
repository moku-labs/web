/**
 * @file spa plugin — in-house NProgress-style top progress bar (no nprogress dep).
 * @see README.md
 */

/** Control surface for the in-house progress bar. */
export interface ProgressBar {
  /**
   * Start the bar (after a 150ms delay) and begin trickling.
   *
   * @returns void
   * @example
   * bar.start();
   */
  start(): void;
  /**
   * Complete and hide the bar.
   *
   * @returns void
   * @example
   * bar.done();
   */
  done(): void;
}

/**
 * Creates the in-house progress bar (150ms delay + trickle). A no-op shell when
 * progress is disabled.
 *
 * @param _enabled - Whether the progress bar is active.
 * @example
 * const bar = createProgressBar(true);
 * bar.start();
 */
export function createProgressBar(_enabled: boolean): ProgressBar {
  throw new Error("not implemented");
}
