/**
 * @file `lazyEmbed` island — activates the static embed facades emitted by the
 * content pipeline's `::embed` directive (pipeline/embed.ts). Mounts on every
 * `[data-component="lazy-embed"]` figure; a click on the facade's button swaps
 * it for the real `<iframe loading="lazy">`. Until that click the embedded
 * document costs the page nothing — no request, no third-party JS, no
 * scroll-jacking. Register it in `pluginConfigs.spa.components`; all visual
 * chrome (`.lazy-embed*` classes) is consumer CSS.
 */
import { createComponent } from "./components";

/** CSS class on the injected `<iframe>` (consumer CSS sizes it). */
const EMBED_FRAME_CLASS = "lazy-embed-frame";

/**
 * Swap a facade `<figure>`'s content for its real `<iframe>`. The iframe
 * carries `loading="lazy"` plus fullscreen permission, and the figure gains
 * `data-embed-active` so consumer CSS can restyle the activated state.
 *
 * @param figure - The facade element carrying `data-embed-src`/`data-embed-title`.
 * @example
 * ```ts
 * activateEmbed(figure);
 * ```
 */
function activateEmbed(figure: HTMLElement): void {
  const src = figure.dataset.embedSrc;
  if (!src) return;

  const iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.title = figure.dataset.embedTitle ?? "";
  iframe.className = EMBED_FRAME_CLASS;
  iframe.setAttribute("loading", "lazy");
  iframe.allow = "fullscreen; autoplay; gamepad";
  iframe.allowFullscreen = true;

  figure.replaceChildren(iframe);
  figure.dataset.embedActive = "";
}

/**
 * Shared click handler (module-level so mount/unmount detach the same
 * reference): any click on the not-yet-active facade activates the embed. It
 * fires on the whole facade — not a specific button class — so a consumer's
 * custom facade markup (see content `embed.facade`) works without re-wiring;
 * the default facade's `<button>` keeps it keyboard-accessible. Once active
 * (`data-embed-active`), clicks fall through to the live iframe.
 *
 * @param event - The click event from the facade figure.
 * @example
 * ```ts
 * element.addEventListener("click", onFacadeClick);
 * ```
 */
function onFacadeClick(event: Event): void {
  const figure = event.currentTarget;
  if (!(figure instanceof HTMLElement)) return;
  if (figure.dataset.embedActive !== undefined) return; // already activated
  activateEmbed(figure);
}

/**
 * Lazy-embed island: facade button click → real `<iframe loading="lazy">`.
 * The companion of the content pipeline's `::embed` directive.
 */
export const lazyEmbed = createComponent("lazy-embed", {
  /**
   * Bind the activation click handler when a facade mounts.
   *
   * @param ctx - The island lifecycle context.
   * @example
   * onMount(ctx);
   */
  onMount(ctx) {
    ctx.el.addEventListener("click", onFacadeClick);
  },
  /**
   * Remove the activation click handler when the facade is destroyed.
   *
   * @param ctx - The island lifecycle context.
   * @example
   * onDestroy(ctx);
   */
  onDestroy(ctx) {
    ctx.el.removeEventListener("click", onFacadeClick);
  }
});
