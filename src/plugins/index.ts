/**
 * Plugin barrel — re-exports all framework plugin instances and type namespaces.
 * Helpers (route, defineRoutes, SEO primitives) are NOT exported here — see src/index.ts.
 */

// ─── Plugin Instances (alphabetical) ─────────────────────────
export { buildPlugin } from "./build";
export { cliPlugin } from "./cli";
export { collectionPlugin } from "./collection";
export { contentPlugin } from "./content";
export { dataPlugin } from "./data";
export { deployPlugin } from "./deploy";
export { envPlugin } from "@moku-labs/common";
export { headPlugin } from "./head";
export { i18nPlugin } from "./i18n";
export { logPlugin } from "@moku-labs/common";
export { routerPlugin } from "./router";
export { sitePlugin } from "./site";
export { spaPlugin } from "./spa";

// ─── Plugin Types (namespace re-exports, alphabetical) ───────
// Consumers access as Router.RouteDefinition, Content.Article, etc.
// site + i18n (Micro) keep types inline and have no namespace entry.
export * as Build from "./build/types";
export * as Cli from "./cli/types";
export * as Collection from "./collection/types";
export * as Content from "./content/types";
export * as Data from "./data/types";
export * as Deploy from "./deploy/types";
export type { Env } from "@moku-labs/common";
export * as Head from "./head/types";
export type { Log } from "@moku-labs/common";
export * as Router from "./router/types";
export * as Spa from "./spa/types";
