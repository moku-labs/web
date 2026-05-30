// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgressBar } from "../../progress";

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("progress bar (enabled)", () => {
  it("shows after the 150ms delay on start and completes on done", () => {
    const bar = createProgressBar(true);
    const el = document.querySelector("[data-progress]") as HTMLElement;
    expect(el).not.toBeNull();

    bar.start();
    // Before the delay elapses, the bar has not activated.
    expect(el.classList.contains("active")).toBe(false);
    vi.advanceTimersByTime(150);
    expect(el.classList.contains("active")).toBe(true);
    // width has activated (>=15%); the first trickle fires synchronously after the delay.
    expect(Number.parseFloat(el.style.width)).toBeGreaterThanOrEqual(15);

    bar.done();
    expect(el.style.width).toBe("100%");
    vi.advanceTimersByTime(200);
    expect(el.classList.contains("active")).toBe(false);
  });

  it("trickles upward while loading but never reaches 100% before done", () => {
    const bar = createProgressBar(true);
    const el = document.querySelector("[data-progress]") as HTMLElement;
    bar.start();
    vi.advanceTimersByTime(150 + 300 * 10);
    const width = Number.parseFloat(el.style.width);
    expect(width).toBeGreaterThan(15);
    expect(width).toBeLessThanOrEqual(90);
  });
});

describe("progress bar (disabled)", () => {
  it("creates no element and start/done are no-ops", () => {
    const bar = createProgressBar(false);
    expect(document.querySelector("[data-progress]")).toBeNull();
    expect(() => {
      bar.start();
      bar.done();
    }).not.toThrow();
  });
});
