import { defineConfig } from "tsdown";

export default defineConfig([
  // Root entry (`.`) — full Node SSG framework. Dual ESM + CJS for broad consumption.
  {
    entry: {
      index: "src/index.ts"
    },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: false,
    tsconfig: "tsconfig.build.json"
  },
  // Browser entry (`./client`) — `hydrate()`. ESM-only (no CJS → no dual-package
  // hazard) and `platform: "browser"` so the bundle stays Node-free. `clean: false`
  // so it does not wipe the root entry's output (the root config cleans first).
  {
    entry: {
      client: "src/client.ts"
    },
    format: ["esm"],
    platform: "browser",
    dts: true,
    clean: false,
    sourcemap: false,
    tsconfig: "tsconfig.build.json"
  }
]);
