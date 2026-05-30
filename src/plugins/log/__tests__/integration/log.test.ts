import { describe, it } from "vitest";

describe("log integration", () => {
  it.todo(
    "createCoreConfig('web-test', { plugins: [logPlugin], pluginConfigs: { log: { mode: 'test' } } }) constructs"
  );
  it.todo("ctx.log.info/expect/trace work inside a regular plugin's api/onInit");
  it.todo("entries accumulate before app.start() (logged during regular-plugin onInit)");
  it.todo("app.log is exposed on the app surface and shares state with ctx.log");
});
