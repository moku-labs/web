/**
 * @file content pipeline — the default `::gallery` component.
 *
 * The built-in inner content of a gallery: a horizontal track of the resolved
 * slides. It is a plain Preact component rendered to **static markup at build
 * time** (no client JS, no hydration) inside the framework-owned
 * `<div data-component="gallery">` wrapper. Consumers swap it for their own via
 * `content` `gallery.component`, or compose it (import + wrap). All visual chrome
 * (`.gallery-*` classes / `data-*` hooks) is consumer CSS + a consumer island; the
 * default track alone is already a usable, scrollable strip with no styling.
 */
import type { VNode } from "preact";
import type { GalleryProps } from "../types";

/** CSS class on the gallery's slide track. */
const GALLERY_TRACK_CLASS = "gallery-track";

/**
 * Default `::gallery` inner content: a single track holding every slide `<img>`
 * in folder order. A companion gallery island (consumer-provided) can enhance
 * the track with swipe/keyboard/lightbox; with no island and no CSS it is still
 * a plain horizontally-scrollable image strip. Provided as the default and as a
 * composable building block for custom galleries.
 *
 * @param props - The gallery props (the resolved `slides`).
 * @returns The gallery inner-content VNode.
 * @example
 * ```tsx
 * // Compose the default inside a richer custom gallery:
 * const MyGallery = (p: GalleryProps) => (
 *   <figure><GalleryTrack {...p} /><figcaption>{p.caption}</figcaption></figure>
 * );
 * ```
 */
export function GalleryTrack(props: GalleryProps): VNode {
  return (
    <div class={GALLERY_TRACK_CLASS} data-gallery-track>
      {props.slides.map(slide => (
        <img key={slide.src} src={slide.src} alt={slide.alt} />
      ))}
    </div>
  );
}
