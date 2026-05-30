import { describe, it } from "vitest";

describe("i18n", () => {
  it.todo("locales() returns the configured array in declared order");
  it.todo("defaultLocale() returns the configured value");
  it.todo("isLocale() is true for configured locales, false otherwise (case-sensitive)");
  it.todo("localeName() returns the mapped name, undefined when unmapped");
  it.todo("ogLocale() returns the mapped og:locale, undefined when unmapped");
  it.todo("t() returns exact hit for the requested locale");
  it.todo("t() falls back to default-locale value on missing key");
  it.todo("t() returns the key verbatim when missing in both locales");
  it.todo("onInit throws when defaultLocale is not in locales");
  it.todo("onInit throws when locales is empty");
  it.todo("onInit does not throw for a valid config");
});
