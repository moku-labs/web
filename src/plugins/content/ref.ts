/**
 * @file content plugin — browser-safe by-name `require` handle.
 *
 * A PURE module (no `node:*`, no value import of the node-only content plugin) so an
 * ISOMORPHIC consumer module — e.g. a `routes.tsx` imported by BOTH the Node build and
 * the browser SPA — can resolve the content API inside a route loader via
 * `ctx.require(contentRef)` WITHOUT dragging content's node code into the client
 * bundle. Mirrors the spa kernel's `dataPluginHandle` pattern. The `_phantom.api` slot
 * is type-only (`import type`), erased at runtime — this file compiles to a plain
 * object literal, safe in the `@moku-labs/web/browser` graph (bundle-safety gate).
 */
import type { Api as ContentApi } from "./types";

/**
 * By-name handle for the OPTIONAL, node-only `content` plugin. `ctx.require` resolves
 * a plugin by its `name` at runtime, so this lets a route loader/generator obtain the
 * content API without importing `contentPlugin` (whose value import would pull node
 * code into a client bundle). The phantom types only the `Api` surface, so
 * `ctx.require(contentRef)` is fully typed as {@link ContentApi}.
 *
 * @example
 * ```ts
 * route("/{slug}/").load(async (ctx) =>
 *   ctx.require(contentRef).load(ctx.params.slug, ctx.locale));
 * ```
 */
export const contentRef: {
  readonly name: "content";
  readonly spec: unknown;
  readonly _phantom: {
    readonly config: unknown;
    readonly state: unknown;
    readonly api: ContentApi;
    readonly events: Record<string, unknown>;
  };
} = {
  name: "content",
  spec: undefined,
  _phantom: {
    config: undefined,
    state: undefined,
    api: undefined as unknown as ContentApi,
    events: {}
  }
};
