/**
 * @file content pipeline — reading-time computation skeleton.
 */

/**
 * Compute reading time (minutes, ceiling with a 1-minute floor) and word count
 * for a Markdown/plain-text body.
 *
 * @param _text - Source body text to measure.
 * @example
 * ```ts
 * const { readingTime, wordCount } = calculateReadingTime(body);
 * ```
 */
export function calculateReadingTime(_text: string): { readingTime: number; wordCount: number } {
  throw new Error("not implemented");
}
