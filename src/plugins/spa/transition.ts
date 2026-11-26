/**
 * @file spa plugin — view-transition tracking for the swap: one transition at a time, and no
 * tap lost to one.
 *
 * While a view transition runs the browser hit-tests to its `::view-transition` pseudo-elements,
 * so a tap reaches `<html>` and never the link under the finger. The tracker keeps the point of
 * such a tap and, when the last transition ends, clicks the link that is under it then.
 *
 * The state is document-wide on purpose: one document runs one view transition at a time. The
 * kernel releases it on teardown with {@link resetTransitionTracking}.
 */

/** The handle `document.startViewTransition` returns: the parts the swap reads. */
export interface ViewTransitionHandle {
  finished?: Promise<unknown>;
  ready?: Promise<unknown>;
  skipTransition?: () => void;
}

/** The view transition now running, so the next swap can skip it. */
let activeTransition: ViewTransitionHandle | undefined;
/** The last tap that landed on `<html>` while a transition ran, replayed when it ends. */
let pendingTap: { x: number; y: number } | undefined;

/**
 * Remember a tap the running transition swallowed: its target is `<html>`.
 *
 * @param event - The click, listened for in the capture phase.
 * @example
 * document.addEventListener("click", rememberSwallowedTap, true);
 */
function rememberSwallowedTap(event: MouseEvent): void {
  if (event.target !== document.documentElement) return;
  pendingTap = { x: event.clientX, y: event.clientY };
}

/**
 * Click the link that is now under the swallowed tap. The click goes through the router like
 * any tap, so a link the SPA leaves to the browser stays the browser's.
 *
 * @param tap - The point of the swallowed tap, if there was one.
 * @example
 * replayTap({ x: 40, y: 700 }); // clicks the tab link under the point
 */
function replayTap(tap: { x: number; y: number } | undefined): void {
  const canHitTest = typeof document.elementsFromPoint === "function";
  if (!tap || !canHitTest) return;

  // The first link under the tap point gets the click the transition swallowed.
  const hits = document.elementsFromPoint(tap.x, tap.y);
  const link = hits.map(element => element.closest("a")).find(Boolean);
  link?.click();
}

/**
 * Forget the running transition and its swallowed tap, and stop listening for taps. The kernel
 * calls it on teardown, so a stopped app never replays a tap.
 *
 * @example
 * resetTransitionTracking(); // kernel.dispose()
 */
export function resetTransitionTracking(): void {
  if (activeTransition) document.removeEventListener("click", rememberSwallowedTap, true);
  activeTransition = undefined;
  pendingTap = undefined;
}

/**
 * Skip the running view transition, if any, so the next one never overlaps it. Its update
 * still applies; only its animation is dropped.
 *
 * @example
 * skipActiveTransition();
 * trackTransition(document.startViewTransition(doSwap));
 */
export function skipActiveTransition(): void {
  activeTransition?.skipTransition?.();
}

/**
 * Track a started view transition until it finishes: listen for swallowed taps while it runs,
 * and replay the last one when it ends. A transition that a newer one replaced ends nothing:
 * the newer one owns the listener and the replay.
 *
 * @param transition - The handle `startViewTransition` returned.
 * @example
 * trackTransition(document.startViewTransition(doSwap));
 */
export function trackTransition(transition: ViewTransitionHandle | undefined): void {
  if (!transition) return;

  // The first running transition starts listening for swallowed taps.
  if (!activeTransition) document.addEventListener("click", rememberSwallowedTap, true);
  activeTransition = transition;

  // When it ends, stop listening and replay the tap, unless a newer transition took over.
  // eslint-disable-next-line jsdoc/require-jsdoc -- inline end-of-transition handler
  const end = (): void => {
    if (activeTransition !== transition) return;
    const tap = pendingTap;
    resetTransitionTracking();
    replayTap(tap);
  };
  Promise.resolve(transition.finished).then(end).catch(end);
}
