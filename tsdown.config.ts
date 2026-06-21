import { defineConfig } from "tsdown";

// Two INDEPENDENT build passes (not two entries in one pass). A single pass would
// let rolldown merge both graphs into one shared chunk — and because the `.` entry
// reaches the node-only plugins (content/build/deploy + node env providers), that
// shared chunk carries `node:`/native code that `./browser` would then import
// wholesale. Building each entry on its own keeps `browser.*` computed from a graph
// that never even references the node-only modules. `clean` runs on the first pass
// only, so the browser pass does not wipe the index output.
export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: false,
    tsconfig: "tsconfig.build.json"
  },
  {
    // ESM-only. A CJS browser build is meaningless: browsers/bundlers consume ESM,
    // `import.meta.env` (browserEnv) becomes `{}` under CJS, and rolldown hoists the
    // data plugin's dynamic `import("./writer")` into a top-level `require()` of the
    // node:fs writer chunk — i.e. CJS would re-introduce the very node coupling this
    // entry exists to avoid. The `.` entry stays dual (esm+cjs) for Node consumers.
    entry: { browser: "src/browser.ts" },
    format: ["esm"],
    dts: true,
    clean: false,
    sourcemap: false,
    tsconfig: "tsconfig.build.json"
  },
  {
    // ESM-only, devDep-only test harness (`@moku-labs/web/testing`). Built as its own
    // pass so it is NEVER part of the `.`/`./browser` graphs — test-only code (and its
    // static Preact import for `renderIsland`) can never reach a client or Node bundle.
    entry: { testing: "src/testing.ts" },
    format: ["esm"],
    dts: true,
    clean: false,
    sourcemap: false,
    tsconfig: "tsconfig.build.json"
  }
]);
