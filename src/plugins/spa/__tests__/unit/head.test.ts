// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Api as HeadApi } from "../../../head/types";
import { syncHead } from "../../head";

const headApi = { render: () => "" } as unknown as HeadApi;

/** Parse an HTML string into a document (the fetched-page document on nav). */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

beforeEach(() => {
  document.head.innerHTML = "<title>Old</title>";
  document.documentElement.lang = "en";
});

afterEach(() => {
  document.head.innerHTML = "";
});

describe("syncHead", () => {
  it("updates the title and <html lang> from the fetched document", () => {
    const doc = parse(`<html lang="uk"><head><title>New</title></head><body></body></html>`);
    syncHead(headApi, doc);
    expect(document.title).toBe("New");
    expect(document.documentElement.lang).toBe("uk");
  });

  it("replaces an existing meta element", () => {
    document.head.innerHTML = `<meta name="description" content="old">`;
    const doc = parse(`<head><meta name="description" content="new"></head>`);
    syncHead(headApi, doc);
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe("new");
  });

  it("appends a meta element present only in the fetched document", () => {
    const doc = parse(`<head><meta property="og:title" content="hello"></head>`);
    syncHead(headApi, doc);
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(
      "hello"
    );
  });

  it("removes a meta element absent from the fetched document", () => {
    document.head.innerHTML = `<link rel="canonical" href="/old">`;
    const doc = parse(`<head></head>`);
    syncHead(headApi, doc);
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("replaces JSON-LD wholesale (remove-all then re-clone)", () => {
    document.head.innerHTML = `<script type="application/ld+json">{"a":1}</script>`;
    const doc = parse(`<head><script type="application/ld+json">{"b":2}</script></head>`);
    syncHead(headApi, doc);
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.textContent).toBe('{"b":2}');
  });
});
