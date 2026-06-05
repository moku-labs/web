/**
 * @file env plugin — public + boundary type definitions.
 */

/**
 * A source of raw environment values.
 *
 * Providers are walked in array order during resolution; the first provider to
 * return a non-`undefined` (and non-empty-string) value for a key wins. `load()`
 * is called exactly once per resolution at `onInit` time, after which both env
 * maps are frozen. A provider like {@link cloudflareBindings} reads `globalThis`
 * at that single `onInit` call (not per request).
 *
 * @example
 * ```ts
 * const custom: EnvProvider = {
 *   name: "vault",
 *   load: () => ({ DB_URL: readVaultSecret("db") })
 * };
 * ```
 */
export interface EnvProvider {
  /** Human-readable provider name, used in diagnostics and error messages. */
  name: string;
  /**
   * Reads this provider's current view of the environment.
   *
   * @returns A flat record of variable names to string values. Keys the
   *   provider cannot supply must be omitted or set to `undefined`.
   */
  load(): Record<string, string | undefined>;
}

/**
 * Declares how a single environment variable is validated and exposed.
 *
 * @example
 * ```ts
 * const port: EnvVarSpec = { public: false, required: false, default: "3000" };
 * const apiBase: EnvVarSpec = { public: true }; // key must start with PUBLIC_
 * const token: EnvVarSpec = { public: false, required: true, secret: true };
 * ```
 */
// eslint-disable-next-line unicorn/prevent-abbreviations -- `EnvVarSpec` is the canonical public type name per spec
export interface EnvVarSpec {
  /**
   * Whether the variable is safe to ship to the browser. When `true`, the key
   * **must** start with {@link EnvConfig.publicPrefix} (cross-checked at
   * `onInit`), and the variable is included in {@link EnvApi.getPublicMap}.
   */
  public: boolean;
  /** Whether resolution fails if the variable is still undefined after defaults. */
  required?: boolean;
  /** Value applied when no provider supplies the variable. */
  default?: string;
  /**
   * Marks the variable as a secret for documentation / tooling. Has no runtime
   * effect on resolution, but secrets are never permitted to be `public`.
   */
  secret?: boolean;
}

/**
 * Configuration for the {@link envPlugin} core plugin.
 *
 * @example
 * ```ts
 * createCoreConfig("web", {
 *   plugins: [envPlugin],
 *   pluginConfigs: {
 *     env: {
 *       schema: {
 *         PUBLIC_API_URL: { public: true, default: "/api" },
 *         SESSION_SECRET: { public: false, required: true, secret: true }
 *       }
 *     }
 *   }
 * });
 * ```
 */
export type EnvConfig = {
  /** Per-variable validation + exposure rules, keyed by variable name. */
  schema: Record<string, EnvVarSpec>;
  /**
   * Ordered list of value sources. The first provider yielding a non-`undefined`
   * (and non-empty-string) value for a key wins. The plugin's own spec default is
   * `[]`; the consumer supplies the providers per target (`[dotenv(), processEnv()]`
   * on Node) — only the `/browser` entry pre-wires `browserEnv()` out of the box.
   */
  providers: EnvProvider[];
  /**
   * Prefix that public variable names must carry. Bidirectionally enforced at
   * `onInit`. Framework default is `"PUBLIC_"`.
   */
  publicPrefix: string;
};

/**
 * Internal env plugin state: the resolved variable table and its public subset.
 * Both maps are populated and frozen (via `freezeMap`) during `onInit`.
 *
 * Exported only to type the `createState` / `api` / `validate` boundary —
 * consumers use {@link EnvApi}, never `EnvState`.
 */
export interface EnvState {
  /** All validated variables that resolved to a defined value (incl. defaults). */
  resolved: Map<string, string>;
  /** Subset of `resolved` where `schema[key].public === true`. */
  publicMap: Map<string, string>;
}

/**
 * The resolved-environment accessor mounted at `ctx.env`. Built by the plugin's
 * `api` factory over `ctx.state` ({@link EnvState}).
 *
 * Available after `onInit` (i.e. inside any plugin's lifecycle and in consumer
 * code). All accessors read from the frozen `resolved` / `publicMap` maps;
 * mutation is impossible.
 *
 * @example
 * ```ts
 * const url = ctx.env.get("PUBLIC_API_URL"); // string | undefined
 * const token = ctx.env.require("DEPLOY_TOKEN"); // string, or throws
 * ```
 */
export type EnvApi = {
  /**
   * Reads a resolved variable.
   *
   * @param key - Variable name.
   * @returns The value, or `undefined` if not present / not in schema.
   */
  get(key: string): string | undefined;
  /**
   * Reads a variable that must exist.
   *
   * @param key - Variable name.
   * @returns The value.
   * @throws {Error} If the variable is undefined.
   */
  require(key: string): string;
  /**
   * Tests presence of a resolved variable.
   *
   * @param key - Variable name.
   * @returns `true` if a value is present.
   */
  has(key: string): boolean;
  /**
   * Returns all public variables as a frozen plain object — convenient for
   * spreading into a serializable payload.
   *
   * @returns A frozen `Record` of public variable names to values.
   */
  getPublic(): Readonly<Record<string, string>>;
  /**
   * Returns the frozen map of public variables. This is the **sole** intended
   * input to a build-time `define` injection: every entry is safe to inline
   * into the browser bundle.
   *
   * @returns The frozen public map.
   */
  getPublicMap(): ReadonlyMap<string, string>;
};
