import { describe, expect, it } from "vitest";
import { calculateReadingTime } from "../../pipeline/reading-time";

describe("content/pipeline/reading-time", () => {
  it("rounds minutes up (ceiling)", () => {
    // ~400 words at 200 wpm = 2 minutes; a bit more must ceil up.
    const words = Array.from({ length: 250 }, () => "word").join(" ");
    const { readingTime } = calculateReadingTime(words);
    expect(readingTime).toBe(Math.ceil(250 / 200));
    expect(Number.isInteger(readingTime)).toBe(true);
  });

  it("enforces a minimum of 1 minute", () => {
    const { readingTime } = calculateReadingTime("just a few words here");
    expect(readingTime).toBe(1);
  });

  it("returns the source word count", () => {
    const { wordCount } = calculateReadingTime("one two three four five");
    expect(wordCount).toBe(5);
  });
});
