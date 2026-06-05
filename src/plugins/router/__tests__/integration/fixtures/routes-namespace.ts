/**
 * @file Fixture: a routes module exporting ONE route per named export, so a consumer
 * can register them with `import * as routes from "./routes"; app.router.set(routes)`.
 * Proves a module namespace object is accepted by `set()`.
 */
import { route } from "../../../builders/route-builder";

/** Home route. */
export const home = route("/").render(() => undefined as never);
/** Article detail route. */
export const article = route("/{slug}/").render(() => undefined as never);
