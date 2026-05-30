/**
 * @file head plugin — API factory.
 *
 * The `render` method pulls `site`/`i18n`/`router` via `ctx.require` at call time,
 * composes the head element set via the shared `compose.ts` module, and serializes
 * it to a string. It holds no resource and caches no subscription.
 */
import { i18nPlugin } from "../i18n";
import { routerPlugin } from "../router";
import { sitePlugin } from "../site";
import { composeHead, serializeHead } from "./compose";
import type { Api, HeadDefaults, State } from "./types";

/** Error prefix for head API invariant failures. */
const ERROR_PREFIX = "[head]";

/**
 * Read the normalized defaults, asserting the post-`onInit` invariant (the slot is
 * `null` only before `onInit` assigns it, which cannot occur at render time).
 *
 * @param state - The head plugin state holder.
 * @returns The non-null normalized defaults snapshot.
 * @throws {Error} If `render` is reached before `onInit` populated the defaults.
 * @example
 * ```ts
 * const defaults = readDefaults(ctx.state);
 * ```
 */
function readDefaults(state: State): HeadDefaults {
  if (state.defaults === null) {
    throw new Error(`${ERROR_PREFIX}: defaults accessed before onInit normalized them.`);
  }
  return state.defaults;
}

/**
 * Structural extraction of a plugin instance's public API from its `_phantom`
 * carrier — mirrors the kernel's (non-exported) `ExtractPluginApi`, so the
 * framework's generic `require` is assignable to {@link ApiContext.require}.
 *
 * @example
 * ```ts
 * type SiteApi = ExtractApi<typeof sitePlugin>;
 * ```
 */
export type ExtractApi<PluginCandidate> = PluginCandidate extends {
  readonly _phantom: { readonly api: infer PluginApi };
}
  ? PluginApi
  : never;

/**
 * The plugin-context slice the head API factory consumes: `state` (for the
 * normalized defaults) and the generic `require` (to pull dependency APIs at
 * call time). Typed to match the kernel's generic `require` so the framework
 * execution context is assignable.
 *
 * @example
 * ```ts
 * const ctx: ApiContext = { state, require: plugin => app[plugin.name] };
 * ```
 */
export type ApiContext = {
  /** Mutable head state holding the normalized defaults snapshot. */
  readonly state: State;
  /** Resolve a depended-upon plugin instance to its public API. */
  require: <
    PluginCandidate extends {
      readonly name: string;
      readonly spec: unknown;
      readonly _phantom: {
        readonly config: unknown;
        readonly state: unknown;
        readonly api: unknown;
        readonly events: Record<string, unknown>;
      };
    }
  >(
    plugin: PluginCandidate
  ) => ExtractApi<PluginCandidate>;
};

/**
 * Creates the head plugin API surface. The single `render` method resolves
 * `site`/`i18n`/`router` via `ctx.require`, composes the route's head elements,
 * and serializes them to `<head>` inner HTML.
 *
 * @param ctx - Plugin context exposing `state` and `require`.
 * @returns The {@link Api} surface mounted at `app.head`.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.render(route, data);
 * ```
 */
export function createApi(ctx: ApiContext): Api {
  return {
    /**
     * Compose the final `<head>` inner HTML for a route (pulled by `build`).
     *
     * @param route - The resolved route descriptor (incl. its `.head()` HeadConfig).
     * @param data - The page data object passed to the route's loader/render.
     * @returns The serialized inner HTML of `<head>`.
     * @example
     * ```ts
     * api.render(route, { title: "Post" });
     * ```
     */
    render(route, data) {
      const elements = composeHead({
        route,
        data,
        defaults: readDefaults(ctx.state),
        site: ctx.require(sitePlugin),
        i18n: ctx.require(i18nPlugin),
        router: ctx.require(routerPlugin)
      });
      return serializeHead(elements);
    }
  };
}
