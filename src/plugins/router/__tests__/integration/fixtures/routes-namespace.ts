/**
 * @file Fixture: a routes module exporting ONE route per named export, so a consumer
 * can register them with `import * as routes from "./routes"` passed to
 * `pluginConfigs.router.routes`. Proves a module namespace object is accepted as the
 * config route map.
 */
import { route } from "../../../builders/route-builder";

/** Home route. */
export const home = route("/").render(() => undefined as never);
/** Article detail route. */
export const article = route("/{slug}/").render(() => undefined as never);
