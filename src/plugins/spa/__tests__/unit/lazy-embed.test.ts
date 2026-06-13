// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { lazyEmbed } from "../../lazy-embed";

/** The facade markup the content pipeline's ::embed directive emits. */
const FACADE_HTML =
  '<figure class="lazy-embed" data-component="lazy-embed"' +
  ' data-embed-src="https://game.example.com/" data-embed-title="My Game">' +
  '<button type="button" class="lazy-embed-button" aria-label="Load embed: My Game">' +
  '<span class="lazy-embed-title">My Game</span>' +
  "</button></figure>";

/** Render the facade into the document and mount the island on it. */
function mountFacade(html: string = FACADE_HTML): HTMLElement {
  document.body.innerHTML = html;
  const figure = document.querySelector("figure") as HTMLElement;
  lazyEmbed.hooks.onMount?.({ el: figure, data: {} });
  return figure;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("spa/lazy-embed island", () => {
  it("is named to match the facade's data-component", () => {
    expect(lazyEmbed.name).toBe("lazy-embed");
  });

  it("activates on a button click: facade swapped for a lazy iframe", () => {
    const figure = mountFacade();

    (figure.querySelector("button") as HTMLButtonElement).click();

    const iframe = figure.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.src).toBe("https://game.example.com/");
    expect(iframe.title).toBe("My Game");
    expect(iframe.getAttribute("loading")).toBe("lazy");
    expect(iframe.className).toBe("lazy-embed-frame");
    expect(iframe.allowFullscreen).toBe(true);
    expect(figure.dataset.embedActive).toBe("");
    expect(figure.querySelector("button")).toBeNull();
  });

  it("activates on a click anywhere on the facade (so custom inner markup works)", () => {
    // A consumer facade with NO .lazy-embed-button — just a div.
    const figure = mountFacade(
      '<figure class="lazy-embed" data-component="lazy-embed"' +
        ' data-embed-src="https://game.example.com/" data-embed-title="My Game">' +
        '<div class="poster">click me</div></figure>'
    );

    (figure.querySelector("div.poster") as HTMLElement).click();

    expect(figure.querySelector("iframe")).not.toBeNull();
    expect(figure.dataset.embedActive).toBe("");
  });

  it("does not re-activate once active (clicks fall through to the iframe)", () => {
    const figure = mountFacade();
    (figure.querySelector("button") as HTMLButtonElement).click();
    const first = figure.querySelector("iframe");

    figure.click();

    expect(figure.querySelectorAll("iframe")).toHaveLength(1);
    expect(figure.querySelector("iframe")).toBe(first);
  });

  it("does nothing when the facade has no data-embed-src", () => {
    const figure = mountFacade(
      '<figure class="lazy-embed" data-component="lazy-embed">' +
        '<button type="button" class="lazy-embed-button">x</button></figure>'
    );

    (figure.querySelector("button") as HTMLButtonElement).click();

    expect(figure.querySelector("iframe")).toBeNull();
  });

  it("stops activating after onDestroy unbinds the handler", () => {
    const figure = mountFacade();

    lazyEmbed.hooks.onDestroy?.({ el: figure, data: {} });
    (figure.querySelector("button") as HTMLButtonElement).click();

    expect(figure.querySelector("iframe")).toBeNull();
  });
});
