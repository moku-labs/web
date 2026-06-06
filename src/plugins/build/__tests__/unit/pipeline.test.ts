import { describe, expect, it } from "vitest";
import { planIncrementalRebuild } from "../../pipeline";

describe("build/pipeline planIncrementalRebuild", () => {
  it("a full build (no/empty changed set) reuses nothing", () => {
    const expected = { contentChanged: [], contentReuse: false, renderReuse: false };
    expect(planIncrementalRebuild(undefined)).toEqual(expected);
    expect(planIncrementalRebuild([])).toEqual(expected);
  });

  it("a Markdown-only change reuses content + renders and lists the changed md", () => {
    const plan = planIncrementalRebuild(["content/intro/en.md", "content/about/en.md"]);
    expect(plan).toEqual({
      contentChanged: ["content/intro/en.md", "content/about/en.md"],
      contentReuse: true,
      renderReuse: true
    });
  });

  it("a CSS-only change reuses content + renders (no markdown to invalidate)", () => {
    expect(planIncrementalRebuild(["src/client/styles.css"])).toEqual({
      contentChanged: [],
      contentReuse: true,
      renderReuse: true
    });
  });

  it("a code change reuses content but busts the render cache (code can change any page)", () => {
    expect(planIncrementalRebuild(["src/components/Card.tsx", "content/intro/en.md"])).toEqual({
      contentChanged: ["content/intro/en.md"],
      contentReuse: true,
      renderReuse: false
    });
  });

  it("an unclassifiable change (a bare directory) forces a full rebuild — correctness over speed", () => {
    expect(planIncrementalRebuild(["content"])).toEqual({
      contentChanged: [],
      contentReuse: false,
      renderReuse: false
    });
  });
});
