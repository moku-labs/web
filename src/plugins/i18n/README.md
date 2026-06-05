# i18n

> **Isomorphic default** — owns the locale registry, default-locale fallback, translation table, and the `og:locale` map.

`i18n` is pure config-as-data: no mutable state, no events, no lifecycle resources. It owns the canonical list of supported locales, the default locale, human-readable display names, the Open Graph `og:locale` mapping, and a flat `locale → (key → value)` translation table. Every accessor is a pure read of the resolved config — nothing mutates, lookups return `undefined` on a miss, and `t()` always returns a string via a deterministic fallback chain.

Consumers reach it as `app.i18n`; sibling plugins (`content`, `router`, `head`, `build`) PULL it read-only via `ctx.require(i18nPlugin)`. It is a leaf of the require graph — it depends on nothing and emits nothing. The one resource it manages is correctness: `onInit` fail-fast validates the config at `createApp` (non-empty `locales`, `defaultLocale ∈ locales`), so there is no `onStart`/`onStop`.

## Example
```ts
import { createApp } from "@moku-labs/web";

const app = createApp({
  pluginConfigs: {
    i18n: {
      locales: ["en", "uk"],
      defaultLocale: "en",
      localeNames: { en: "English", uk: "Українська" },
      ogLocaleMap: { en: "en_US", uk: "uk_UA" },
      translations: {
        en: { "nav.home": "Home", "nav.about": "About" },
        uk: { "nav.home": "Головна" }
      }
    }
  }
});

app.i18n.t("uk", "nav.home");  // "Головна"     (exact hit)
app.i18n.t("uk", "nav.about"); // "About"        (falls back to en)
app.i18n.ogLocale("uk");       // "uk_UA"
```

## API
All methods are pure reads over `ctx.config`. None mutate, none throw; lookups return `undefined` for a miss, and `t()` always returns a string.

| Method | Signature | Notes |
|---|---|---|
| `locales` | `() => readonly string[]` | Configured locales in declared (priority/display) order. |
| `defaultLocale` | `() => string` | The configured fallback locale. |
| `isLocale` | `(x: string) => boolean` | Case-sensitive membership guard (`locales.includes(x)`). |
| `localeName` | `(locale: string) => string \| undefined` | Display name, or `undefined` if unmapped. |
| `ogLocale` | `(locale: string) => string \| undefined` | `og:locale` value (e.g. `"en_US"`), or `undefined` if unmapped. |
| `t` | `(locale: string, key: string) => string` | Translation with the fallback chain below. |

### `t()` fallback chain

1. `translations[locale][key]` — exact hit for the requested locale.
2. `translations[defaultLocale][key]` — default-locale value (skipped when `locale === defaultLocale`).
3. `key` — the key itself, surfaced verbatim so missing translations are visible.

```ts
// translations: { en: { "nav.home": "Home", "nav.about": "About" }, uk: { "nav.home": "Головна" } }
app.i18n.t("uk", "nav.home");    // "Головна"      (exact hit)
app.i18n.t("uk", "nav.about");   // "About"        (falls back to en)
app.i18n.t("uk", "nav.missing"); // "nav.missing"  (key fallback)
```

## Configuration
`pluginConfigs.i18n` — `locales` and `defaultLocale` are required and validated in `onInit` (fail-fast at `createApp`). The optional maps default to `{}` so every lookup is total.

| Field | Type | Default | Notes |
|---|---|---|---|
| `locales` | `readonly string[]` | `["en"]` | Supported locales, in priority/display order. Must be non-empty. |
| `defaultLocale` | `string` | `"en"` | Fallback locale. Must be a member of `locales`. |
| `localeNames` | `Record<string, string>` | `{}` | Display name per locale (e.g. `{ en: "English" }`). |
| `ogLocaleMap` | `Record<string, string>` | `{}` | `og:locale` value per locale (e.g. `{ en: "en_US" }`). |
| `translations` | `Record<string, Record<string, string>>` | `{}` | Flat `locale → (key → value)` map. |

> [!NOTE]
> Validation throws a `[web]`-prefixed `Error` with an actionable remediation line when `locales` is empty or `defaultLocale` is not a member of `locales`.

## Dependencies
None. `i18n` is a Wave 1 leaf of the require graph — it declares no `depends`, requires nothing, and is depended *on* by `content`, `router`, `head`, and `build` (each via `ctx.require(i18nPlugin)`).

## Events
None — emits no events and listens to none.

## Design notes

- **Config-as-data, total lookups.** All five config maps resolve to a value or `{}`, so every accessor is total: it either returns the mapped value or `undefined` (for the maps) / the key (for `t()`). No accessor can throw at runtime.
- **Deterministic translation fallback.** `t()` never returns `undefined`: requested locale → default locale → the key verbatim. Surfacing the raw key on a miss keeps untranslated strings visible in the UI rather than blank.
- **Fail-fast, not silent.** The only failure mode is configuration. `onInit` rejects an empty `locales` array or a `defaultLocale` outside `locales` at `createApp`, before any page renders.
- **Owns `og:locale`, not `hreflang`.** `i18n` exposes the `og:locale` map only. The `hreflang` `<link>` alternates are composed downstream by `head`/`router` from this locale registry — `i18n` itself has no hreflang field or accessor.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | Wiring harness — typed `defaultConfig`, `onInit: validateI18nConfig`, `api: createI18nApi`. |
| `api.ts` | `validateI18nConfig` (config validation) + `createI18nApi` (the `app.i18n` accessor surface). |
| `types.ts` | Public `Config` and `Api` type definitions. |

---

<sub>Part of <strong><a href="../../../README.md">@moku-labs/web</a></strong> — built on <a href="https://github.com/moku-labs/core">@moku-labs/core</a>.</sub>
