/**
 * Default Heuristic Parser — Markdown-preservation Test Suite (issue #16)
 *
 * Covers:
 *  1. JSON-LD JobPosting branch: HTML descriptions are converted to Markdown
 *     (no raw HTML tags stored).
 *  2. Already-plain-text JSON-LD descriptions are left as-is.
 *  3. ATS URL-pattern fallback branch (no descriptions).
 */

import { defaultParser } from '../../parsers/default';
import { expectMarkdownDescription, expectNoHtmlTags } from '../helpers/markdown';

// ─── JSON-LD JobPosting — HTML to Markdown ───────────────────────────────────

describe('defaultParser — JSON-LD JobPosting Markdown contract', () => {
  const html = `
    <html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "Product Manager",
        "url": "https://example.com/jobs/pm-1",
        "jobLocation": { "@type": "Place", "address": { "addressLocality": "Berlin" } },
        "description": "<h2>About the role</h2><p>We are <strong>hiring</strong> a PM.</p><ul><li>Roadmap</li><li>Discovery</li></ul>"
      }
      </script>
    </head><body></body></html>`;

  const jobs = defaultParser(html, 'https://example.com/careers');

  it('should parse the JobPosting', () => {
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Product Manager');
    expect(jobs[0].url).toBe('https://example.com/jobs/pm-1');
    expect(jobs[0].location).toBe('Berlin');
  });

  it('should convert the HTML description to Markdown', () => {
    const desc = jobs[0].description!;
    expectMarkdownDescription(desc, { sourceHadMarkdownMarkers: true });
    expect(desc).toContain('## About the role');
    expect(desc).toContain('**hiring**');
    expect(desc).toContain('- Roadmap');
  });
});

describe('defaultParser — JSON-LD plain-text description', () => {
  const html = `
    <html><head>
      <script type="application/ld+json">
      {
        "@type": "JobPosting",
        "title": "Plain Text Job",
        "url": "https://example.com/jobs/plain-1",
        "description": "A **plain text** description with no HTML tags."
      }
      </script>
    </head><body></body></html>`;

  const jobs = defaultParser(html, 'https://example.com/careers');

  it('should leave plain-text/Markdown descriptions intact', () => {
    expect(jobs).toHaveLength(1);
    const desc = jobs[0].description!;
    expectNoHtmlTags(desc);
    expect(desc).toBe('A **plain text** description with no HTML tags.');
  });
});

// ─── ATS URL-pattern fallback ────────────────────────────────────────────────

describe('defaultParser — ATS URL-pattern fallback', () => {
  const html = `
    <html><body>
      <a href="/jobs/123-software-engineer">Software Engineer</a>
      <a href="/careers/456-data-analyst">Data Analyst</a>
    </body></html>`;

  const jobs = defaultParser(html, 'https://example.com');

  it('should extract jobs from ATS-pattern links', () => {
    expect(jobs.length).toBe(2);
    expect(jobs[0].url).toBe('https://example.com/jobs/123-software-engineer');
  });
});
