import { describe, it } from "vitest";

describe("site", () => {
  it.todo("name()/url()/author()/description() return the configured values");
  it.todo("canonical() joins a leading-slash path against the base url");
  it.todo("canonical() joins a no-leading-slash path against the base url");
  it.todo("canonical('') and canonical('/') return the base url unchanged");
  it.todo("canonical() preserves the supplied path's trailing slash and avoids double slashes");
  it.todo("onInit throws on empty/whitespace name with [web] site.name message");
  it.todo("onInit throws on missing/non-absolute/non-http url with [web] site.url message");
  it.todo("onInit does not throw for a valid name + absolute http/https url");
});
