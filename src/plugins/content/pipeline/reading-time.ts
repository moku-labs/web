/**
 * @file content pipeline — reading-time computation.
 */
import readingTime from "reading-time";

/**
 * Compute reading time (minutes, ceiling with a 1-minute floor) and word count
 * for a Markdown/plain-text body. Wraps the `reading-time` library, applying a
 * `Math.ceil` with a 1-minute minimum so every article reads as at least one
 * minute.
 *
 * @param text - Source body text to measure.
 * @returns The reading time in whole minutes and the source word count.
 * @example
 * ```ts
 * const { readingTime, wordCount } = calculateReadingTime(body);
 * ```
 */
export function calculateReadingTime(text: string): { readingTime: number; wordCount: number } {
  const stats = readingTime(text);
  return {
    readingTime: Math.max(1, Math.ceil(stats.minutes)),
    wordCount: stats.words
  };
}
