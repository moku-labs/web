# i18n

> Micro plugin — locale registry + flat translation helper with default-locale fallback.

Pure config-as-data: no mutable state, no events, no lifecycle resources. Owns the
canonical list of supported locales, the default locale, human-readable display names,
the Open Graph `og:locale` mapping, and a flat translation table. Consumed read-only by
`content`, `router`, `head`, and `build` via `ctx.require(i18nPlugin)`, and exposed to
consumers as `app.i18n`.

## Configuration

`locales` and `defaultLocale` are required and validated in `onInit` (fail-fast at
`createApp`). The optional maps default to `{}` so every lookup is total.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `locales` | `readonly string[]` | `["en"]` | Supported locales, in priority/display order. Must be non-empty. |
| `defaultLocale` | `string` | `"en"` | Fallback locale. Must be a member of `locales`. |
| `localeNames` | `Record<string, string>` | `{}` | Display name per locale (e.g. `{ en: "English" }`). |
| `ogLocaleMap` | `Record<string, string>` | `{}` | `og:locale` value per locale (e.g. `{ en: "en_US" }`). |
| `translations` | `Record<string, Record<string, string>>` | `{}` | Flat `locale → (key → value)` map. |

```ts
createApp({
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
```

## API

All methods are pure reads over `ctx.config`. They never mutate and never throw;
lookups return `undefined` for misses, and `t()` always returns a string.

| Method | Returns | Description |
|--------|---------|-------------|
| `locales()` | `readonly string[]` | Configured locales in declared order. |
| `defaultLocale()` | `string` | The configured fallback locale. |
| `isLocale(x)` | `boolean` | Case-sensitive membership guard (`locales.includes(x)`). |
| `localeName(locale)` | `string \| undefined` | Display name, or `undefined` if unmapped. |
| `ogLocale(locale)` | `string \| undefined` | `og:locale` value, or `undefined` if unmapped. |
| `t(locale, key)` | `string` | Translation with fallback chain. |

### `t()` fallback chain

1. `translations[locale][key]` — exact hit for the requested locale.
2. `translations[defaultLocale][key]` — default-locale value (skipped when
   `locale === defaultLocale`).
3. `key` — the key itself, surfaced verbatim so missing translations are visible.

```ts
// translations: { en: { "nav.home": "Home", "nav.about": "About" }, uk: { "nav.home": "Головна" } }
app.i18n.t("uk", "nav.home");    // "Головна"     (exact hit)
app.i18n.t("uk", "nav.about");   // "About"        (falls back to en)
app.i18n.t("uk", "nav.missing"); // "nav.missing"  (key fallback)
```

## Lifecycle

- **onInit:** validates `locales` is non-empty and `defaultLocale ∈ locales`. Throws a
  `[web]`-prefixed error with a remediation line on the first failure.
- No `onStart` / `onStop` — there is no resource to manage.

## Dependencies & events

None. i18n is a Wave 1 leaf of the require graph — it is depended *on* by
`content`/`router`/`head`/`build`, and requires nothing.
