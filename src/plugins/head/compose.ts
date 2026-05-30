/**
 * @file head plugin — shared pure composition module (reused by `spa` in Increment B)
 *
 * The pure composition logic — `(HeadConfig, defaults, locales, urls) → HeadElement[]` —
 * lives here so `spa` can import it without making `head` depend on `spa`. Dependency
 * direction is strictly `spa → head`; `head` must never import `spa`.
 */
import { canonical, hreflang, meta, og, twitter } from "./primitives";
import type { HeadConfig, HeadDefaults, HeadElement, ResolvedRoute } from "./types";

/** Structural slice of the `site` plugin API read during composition. */
export type SiteSlice = {
  /** Site name (title fallback + og:site_name). */
  name(): string;
  /** Absolute base URL, used to resolve relative og images. */
  url(): string;
  /** Default site description (description fallback). */
  description(): string;
  /** Join a path against the base URL to an absolute canonical URL. */
  canonical(path: string): string;
};

/** Structural slice of the `i18n` plugin API read during composition. */
export type I18nSlice = {
  /** Supported locales (drives the hreflang alternate set). */
  locales(): readonly string[];
  /** Open Graph `og:locale` value for a locale, or `undefined`. */
  ogLocale(locale: string): string | undefined;
};

/** Structural slice of the `router` plugin API read during composition. */
export type RouterSlice = {
  /** Build a URL for a named route from params. */
  toUrl(routeName: string, params: Record<string, string>): string;
};

/**
 * Inputs required to compose a route's head element set, gathered by `render` from the
 * route, page data, normalized defaults, and the resolved `site`/`i18n`/`router` APIs.
 *
 * @example
 * ```ts
 * const input: ComposeInput = { route, data, defaults, site, i18n, router };
 * ```
 */
export type ComposeInput = {
  /** The resolved route descriptor (incl. its `.head()` HeadConfig). */
  route: ResolvedRoute;
  /** The page data object passed to the route's loader/render. */
  data: unknown;
  /** The normalized head defaults snapshot (populated after `onInit`). */
  defaults: HeadDefaults;
  /** The resolved `site` plugin API slice. */
  site: SiteSlice;
  /** The resolved `i18n` plugin API slice. */
  i18n: I18nSlice;
  /** The resolved `router` plugin API slice. */
  router: RouterSlice;
};

/** The `x-default` hreflang sentinel locale. */
const X_DEFAULT = "x-default";

/**
 * Apply a `%s` title template to a resolved title (or return the title verbatim when
 * no template is configured).
 *
 * @param title - The resolved page title.
 * @param template - The configured title template (may be `undefined`).
 * @returns The templated title string.
 * @example applyTemplate("Home", "%s — Site") // "Home — Site"
 */
function applyTemplate(title: string, template: string | undefined): string {
  return template === undefined ? title : template.replaceAll("%s", title);
}

/**
 * Resolve a possibly-relative image URL against the site base URL.
 *
 * @param image - The image URL (relative or absolute).
 * @param site - The site slice used to absolutize relative paths.
 * @returns The absolute image URL.
 * @example resolveImage("/og.png", site) // "https://blog.dev/og.png"
 */
function resolveImage(image: string, site: SiteSlice): string {
  return image.startsWith("http") ? image : site.canonical(image);
}

/**
 * Build the canonical, og, twitter, and hreflang elements for the route from
 * the resolved title/description, defaults, and dependency slices.
 *
 * @param input - The gathered composition inputs.
 * @param resolved - The resolved title/description/canonical URL.
 * @param resolved.title - The templated page title.
 * @param resolved.description - The resolved description.
 * @param resolved.canonicalUrl - The resolved absolute canonical URL.
 * @returns The ordered base element set (excluding route-supplied extras).
 * @example buildBaseElements(input, { title, description, canonicalUrl })
 */
function buildBaseElements(
  input: ComposeInput,
  resolved: { title: string; description: string; canonicalUrl: string }
): HeadElement[] {
  const { route, defaults, site, i18n, router } = input;
  const head: HeadConfig = route.head ?? {};
  const image = head.image ?? defaults.defaultOgImage;
  const elements: HeadElement[] = [
    { tag: "title", children: resolved.title, key: "title" },
    meta("description", resolved.description),
    og("og:title", head.title ?? resolved.title),
    og("og:description", resolved.description),
    og("og:url", resolved.canonicalUrl),
    twitter("twitter:card", defaults.twitterCard),
    twitter("twitter:title", head.title ?? resolved.title),
    twitter("twitter:description", resolved.description)
  ];
  if (image) {
    const abs = resolveImage(image, site);
    elements.push(og("og:image", abs), twitter("twitter:image", abs));
  }
  if (defaults.twitterHandle) elements.push(twitter("twitter:site", defaults.twitterHandle));
  const ogLocale = route.locale ? i18n.ogLocale(route.locale) : undefined;
  if (ogLocale) elements.push(og("og:locale", ogLocale));
  elements.push(canonical(resolved.canonicalUrl));
  for (const locale of i18n.locales()) {
    const href = site.canonical(router.toUrl(route.name, { ...route.params, lang: locale }));
    elements.push(hreflang(locale, href));
  }
  const xDefaultHref = site.canonical(router.toUrl(route.name, { ...route.params }));
  elements.push(hreflang(X_DEFAULT, xDefaultHref));
  return elements;
}

/**
 * De-duplicate elements by `key`, keeping the LAST occurrence (route-supplied
 * overrides win over generated defaults). Keyless elements are always retained.
 *
 * @param elements - The full ordered element list.
 * @returns The de-duplicated list in first-seen position with last-wins content.
 * @example dedupeByKey([meta("description", "a"), meta("description", "b")])
 */
function dedupeByKey(elements: HeadElement[]): HeadElement[] {
  const byKey = new Map<string, HeadElement>();
  const order: string[] = [];
  const keyless: HeadElement[] = [];
  for (const element of elements) {
    if (element.key === undefined) {
      keyless.push(element);
      continue;
    }
    if (!byKey.has(element.key)) order.push(element.key);
    byKey.set(element.key, element);
  }
  // biome-ignore lint/style/noNonNullAssertion: keys in `order` are guaranteed present in `byKey`.
  return [...order.map(k => byKey.get(k)!), ...keyless];
}

/**
 * Compose the ordered, de-duplicated `HeadElement[]` for a route from site defaults,
 * i18n hreflang alternates, and the route's head config.
 *
 * @param input - The gathered composition inputs.
 * @returns The ordered, de-duplicated head element set.
 * @example composeHead({ route, data, defaults, site, i18n, router })
 */
export function composeHead(input: ComposeInput): HeadElement[] {
  const { route, defaults, site, router } = input;
  const head: HeadConfig = route.head ?? {};
  const title = applyTemplate(head.title ?? site.name(), defaults.titleTemplate);
  const description = head.description ?? site.description();
  const canonicalUrl =
    head.canonical ?? site.canonical(router.toUrl(route.name, { ...route.params }));
  const base = buildBaseElements(input, { title, description, canonicalUrl });
  return dedupeByKey([...base, ...(head.elements ?? [])]);
}

/**
 * HTML-escape a value for safe insertion into an attribute or text node. `&` is
 * escaped first so already-escaped entities are not double-escaped.
 *
 * @param raw - The unsafe string.
 * @returns The HTML-escaped string.
 * @example escapeHtml('a & "b" <c>') // "a &amp; &quot;b&quot; &lt;c&gt;"
 */
function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Serialize a single `HeadElement` to its HTML string form. Attribute values are
 * HTML-escaped; `script` children are emitted verbatim (already unicode-escaped by
 * `jsonLd`); `title` text is HTML-escaped.
 *
 * @param element - The element to serialize.
 * @returns A single line of HTML.
 * @example serializeElement(meta("robots", "index"))
 */
function serializeElement(element: HeadElement): string {
  const attributes = Object.entries(element.attrs ?? {})
    .map(([k, v]) => `${k}="${escapeHtml(v)}"`)
    .join(" ");
  const open = attributes.length === 0 ? element.tag : `${element.tag} ${attributes}`;
  if (element.tag === "script") return `<script ${attributes}>${element.children ?? ""}</script>`;
  if (element.tag === "title") return `<title>${escapeHtml(element.children ?? "")}</title>`;
  return `<${open}>`;
}

/**
 * Serialize a `HeadElement[]` to `<head>` inner HTML. All attribute values are
 * HTML-attribute-escaped; JSON-LD payloads are already unicode-escaped by `jsonLd`.
 *
 * @param elements - The composed head elements.
 * @returns The serialized inner HTML of `<head>` (no surrounding `<head>` tags).
 * @example serializeHead(composeHead(input))
 */
export function serializeHead(elements: HeadElement[]): string {
  return elements.map(element => serializeElement(element)).join("");
}
