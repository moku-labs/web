/**
 * @file router plugin — API factory.
 *
 * Closures over `ctx.state.table` exposing `match` / `toUrl` / `entries` /
 * `manifest`. Returns values/copies, never the raw `ctx.state` reference (spec/11 §2.4).
 */
import { matchRoute } from "./builders/match";
import type {
  ClientRoute,
  CompiledRoute,
  MatcherTable,
  RouterApi,
  RouterState,
  TypedRoute
} from "./types";

/** Error prefix for router API failures. */
const ERROR_PREFIX = "[web] router";

/** Plugin context surface consumed by the router API factory. */
interface RouterApiContext {
  /** Mutable router state holding the compiled matcher table. */
  readonly state: RouterState;
}

/**
 * Read the compiled matcher table, throwing if `onInit` has not run yet. This
 * `null` cannot occur in practice post-`onInit`; the guard documents the invariant.
 *
 * @param state - The router plugin state holder.
 * @returns The compiled, non-null matcher table.
 * @throws {Error} If the matcher table has not been compiled yet.
 * @example
 * ```ts
 * const table = readTable(ctx.state);
 * ```
 */
function readTable(state: RouterState): MatcherTable {
  if (state.table === null) {
    throw new Error(`${ERROR_PREFIX}: matcher table accessed before onInit compiled it.`);
  }
  return state.table;
}

/**
 * Project a compiled route into the public `TypedRoute` URL-utility view.
 *
 * @param entry - The compiled route entry.
 * @returns A `TypedRoute` exposing pattern/name/meta + toUrl/toFile/match.
 * @example
 * ```ts
 * toTypedRoute(compiledEntry).toUrl({ slug: "x" });
 * ```
 */
function toTypedRoute(entry: CompiledRoute): TypedRoute {
  return {
    pattern: entry.pattern,
    name: entry.name,
    meta: { ...entry.meta },
    toUrl: entry.toUrl,
    toFile: entry.toFile,
    match: entry.matchFn
  };
}

/**
 * Project a compiled route into the serializable {@link ClientRoute} view: only
 * `pattern` / `name` / `meta`, with a fresh `meta` copy and NO `_handlers` closures.
 *
 * @param entry - The compiled route entry.
 * @returns A `ClientRoute` carrying only JSON-serializable fields.
 * @example
 * ```ts
 * toClientRoute(compiledEntry); // { pattern, name, meta }
 * ```
 */
function toClientRoute(entry: CompiledRoute): ClientRoute {
  return { pattern: entry.pattern, name: entry.name, meta: { ...entry.meta } };
}

/**
 * Creates the router plugin API surface. Every closure reads the compiled table
 * from `ctx.state` and returns values/fresh copies — never the raw state arrays.
 *
 * @param ctx - Plugin context.
 * @param ctx.state - The router state holding the compiled matcher table.
 * @returns The {@link RouterApi} surface mounted at `ctx.router`.
 * @example
 * ```ts
 * const api = createApi({ state });
 * api.match("/en/hello/");
 * ```
 */
export function createApi(ctx: RouterApiContext): RouterApi {
  const { state } = ctx;
  return {
    /**
     * Match a pathname against the compiled route table (specificity-sorted).
     *
     * @param pathname - URL pathname, e.g. `/en/hello/`.
     * @returns `{ params, route }` for the most specific match, or `null`.
     * @example
     * ```ts
     * api.match("/en/hello/");
     * ```
     */
    match(pathname) {
      return matchRoute(readTable(state).compiled, pathname);
    },
    /**
     * Build a URL for a named route from params.
     *
     * @param routeName - Route name key from the route map.
     * @param params - Param values to substitute into the pattern.
     * @returns The resolved URL string (e.g. `/en/hello/`).
     * @throws {Error} If `routeName` is unknown.
     * @example
     * ```ts
     * api.toUrl("article", { lang: "en", slug: "hello" });
     * ```
     */
    toUrl(routeName, params) {
      const entry = readTable(state).byName.get(routeName);
      if (!entry) {
        throw new Error(`${ERROR_PREFIX}: unknown route name "${routeName}".`);
      }
      return entry.toUrl(params);
    },
    /**
     * All resolved routes as typed URL utilities, in specificity order.
     *
     * @returns A fresh read-only array of resolved typed routes.
     * @example
     * ```ts
     * for (const r of api.entries()) r.toUrl({ slug: "x" });
     * ```
     */
    entries() {
      return readTable(state).compiled.map(entry => toTypedRoute(entry));
    },
    /**
     * The typed route set for build-time consumption (declaration order). An API
     * return, NOT a config readback — preserves per-route types despite erasure.
     *
     * @returns A fresh read-only array of the typed route definitions.
     * @example
     * ```ts
     * for (const def of api.manifest()) def._handlers.load?.({}, "en");
     * ```
     */
    manifest() {
      return [...readTable(state).byName.values()].map(entry => entry.definition);
    },
    /**
     * Serializable, specificity-sorted projection of the route table for client
     * shipping — `{ pattern, name, meta }` entries with NO `_handlers` closures.
     *
     * @returns A fresh, frozen, specificity-sorted read-only array of client routes.
     * @example
     * ```ts
     * const json = JSON.stringify(api.clientManifest());
     * ```
     */
    clientManifest() {
      return Object.freeze(readTable(state).compiled.map(entry => toClientRoute(entry)));
    }
  };
}
