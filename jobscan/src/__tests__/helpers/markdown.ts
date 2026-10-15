/**
 * Shared Markdown-description assertions for parser tests.
 *
 * The full-description tool contract promises Markdown. Every parser that
 * produces a job description must store Markdown, never raw HTML. These
 * helpers assert that invariant across parser tests.
 */

/**
 * Matches any HTML tag (opening or closing), e.g. <p>, <div class="x">, </span>.
 * Deliberately does NOT match Markdown autolinks like <https://example.com>:
 * after the tag name only whitespace, attributes, or '>' may follow.
 */
const HTML_TAG_RE = /<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>/i;

/**
 * Assert a stored description is Markdown-safe:
 *  - truthy and non-empty
 *  - contains no HTML tags (the core contract)
 * If `sourceHadMarkdownMarkers` is true, also assert Markdown structure
 * (headings, list bullets, or bold) survived the conversion.
 */
export function expectMarkdownDescription(
  description: string | undefined,
  options: { sourceHadMarkdownMarkers?: boolean } = {},
): void {
  expect(description).toBeTruthy();
  const desc = description as string;
  expect(desc).not.toMatch(HTML_TAG_RE);
  if (options.sourceHadMarkdownMarkers) {
    expect(desc).toMatch(/(^|\n)\s*(#{1,6}\s|[-*]\s)|\*\*[^*]+\*\*/);
  }
}

/**
 * Assert a description contains no HTML tags at all (regardless of source).
 */
export function expectNoHtmlTags(description: string | undefined): void {
  expect(description).toBeTruthy();
  expect(description as string).not.toMatch(HTML_TAG_RE);
}
