// @vitest-environment happy-dom
import type { VNode } from "preact";
import { h } from "preact";
import { describe, expect, it } from "vitest";
import { renderVNode } from "../../render";

/** A `data-page`-tagged div VNode, typed as the plain VNode `renderVNode` accepts. */
function page(n: number): VNode {
  return h("div", { "data-page": String(n) }, `page ${n}`) as VNode;
}

describe("spa/render renderVNode", () => {
  it("clears static SSR once, then preserves content across consecutive renders", () => {
    const region = document.createElement("section");
    region.innerHTML = "<p data-ssr>server markup</p>"; // pre-existing SSR content
    document.body.append(region);

    // First client render: SSR is cleared, the VNode mounts.
    renderVNode(page(1), region);
    expect(region.querySelector("[data-ssr]")).toBeNull();
    expect(region.querySelector("[data-page='1']")?.textContent).toBe("page 1");

    // Regression: a SECOND consecutive render into the SAME region used to go blank
    // (kernel cleared the DOM via replaceChildren while Preact still held the prior
    // vdom → the diff patched detached nodes). It must now show the new content.
    renderVNode(page(2), region);
    expect(region.textContent).toContain("page 2");
    expect(region.querySelector("[data-page='2']")?.textContent).toBe("page 2");

    // Third, to be sure the region stays Preact-owned.
    renderVNode(page(3), region);
    expect(region.textContent).toContain("page 3");
    expect(region.querySelector("[data-page='3']")).not.toBeNull();
  });
});
