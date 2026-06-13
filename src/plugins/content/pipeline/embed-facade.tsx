/**
 * @file content pipeline — the default `::embed` facade component.
 *
 * The built-in inner content of an embed facade: a labelled activation button.
 * It is a plain Preact component rendered to **static markup at build time**
 * (no client JS, no hydration) inside the framework-owned `<figure>` wrapper.
 * Consumers can swap it for their own via `content` `embed.facade`, or compose
 * it (import + wrap). All visual chrome (`.lazy-embed*` classes) is consumer CSS.
 */
import type { VNode } from "preact";
import type { EmbedFacadeProps } from "../types";

/** CSS class on the facade's activation button. */
const EMBED_BUTTON_CLASS = "lazy-embed-button";

/** CSS class on the title span inside the activation button. */
const EMBED_TITLE_CLASS = "lazy-embed-title";

/**
 * Default `::embed` facade inner content: a single labelled `<button>` carrying
 * the embed title. The companion `lazyEmbed` island activates the embed on a
 * click anywhere in the facade, so the button is the keyboard-accessible
 * control. Provided as the default and as a composable building block for custom
 * facades.
 *
 * @param props - The embed facade props (only `title` is used by the default).
 * @returns The facade inner-content VNode.
 * @example
 * ```tsx
 * // Compose the default inside a richer custom facade:
 * const MyFacade = (p: EmbedFacadeProps) => (
 *   <div class="poster"><img src={p.attributes.poster} alt="" /><EmbedFacadeButton {...p} /></div>
 * );
 * ```
 */
export function EmbedFacadeButton(props: EmbedFacadeProps): VNode {
  return (
    <button type="button" class={EMBED_BUTTON_CLASS} aria-label={`Load embed: ${props.title}`}>
      <span class={EMBED_TITLE_CLASS}>{props.title}</span>
    </button>
  );
}
