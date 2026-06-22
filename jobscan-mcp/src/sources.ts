import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jobscanFetch } from './api.js';

// T007: jobscan_detect_source
// T008: jobscan_add_source
// T009: jobscan_list_parsers
// T031: jobscan_list_sources   (added in Phase 9)
// T032: jobscan_delete_source  (added in Phase 9)

/**
 * Extract the human-readable error message from a jobscanFetch error string.
 * Error format: "JobScan API error <status> <statusText>: <body>"
 * The body is JSON with an "error" field, e.g. {"error": "Unknown parser ..."}
 */
function extractApiError(msg: string): string {
  // Try to extract JSON body from the error string
  const bodyMatch = msg.match(/:\s*(\{.*\})\s*$/);
  if (bodyMatch) {
    try {
      const parsed = JSON.parse(bodyMatch[1]);
      if (typeof parsed.error === 'string') return parsed.error;
    } catch {
      // fall through
    }
  }
  return msg;
}

export function registerSourcesTools(server: McpServer): void {
  // ─── jobscan_detect_source ─────────────────────────────────────────────────
  server.tool(
    'jobscan_detect_source',
    'Auto-detect the parser and company name from a careers page URL. Call this before jobscan_add_source to confirm the right parser will be used. Returns { url, company, parser }.',
    {
      url: z.string().url().describe('The careers page URL to detect the parser for.'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ url }) => {
      try {
        const result = await jobscanFetch('/api/sources/detect', {
          method: 'POST',
          body: JSON.stringify({ url }),
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('400')) {
          const apiError = extractApiError(msg);
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `${apiError} Try jobscan_add_source with parser='default' for unlisted ATS platforms.`,
              },
            ],
          };
        }
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_add_source ────────────────────────────────────────────────────
  server.tool(
    'jobscan_add_source',
    'Register a new company careers page as a tracked source. Triggers an immediate first scrape and returns the source record plus how many jobs were found. Use jobscan_detect_source first to confirm the parser.',
    {
      company: z.string().min(1).describe('Company name, e.g. "Stripe".'),
      url: z.string().url().describe('The careers page URL.'),
      parser: z.string().min(1).describe('Parser name (e.g. "greenhouse"). Use jobscan_list_parsers to see all options.'),
    },
    { openWorldHint: true },
    async ({ company, url, parser }) => {
      try {
        const result = await jobscanFetch('/api/sources', {
          method: 'POST',
          body: JSON.stringify({ company, url, parser }),
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('409')) {
          // Try to extract company/id from response body
          const match = msg.match(/"company"\s*:\s*"([^"]+)".*?"id"\s*:\s*(\d+)/s) ??
            msg.match(/company '([^']+)'.*?ID (\d+)/s);
          if (match) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `A source with this URL already exists: company '${match[1]}' (ID ${match[2]}). Use jobscan_list_sources to see it.`,
                },
              ],
            };
          }
          return {
            isError: true,
            content: [{ type: 'text', text: `A source with this URL already exists. Use jobscan_list_sources to see it.` }],
          };
        }
        if (msg.includes('400')) {
          // Extract the actual error from the API response body instead of assuming the cause.
          // The backend returns 400 for multiple reasons: unknown parser, URL 404 preflight,
          // invalid URL format, missing fields, etc.
          const apiError = extractApiError(msg);
          return {
            isError: true,
            content: [{ type: 'text', text: apiError }],
          };
        }
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_list_parsers ──────────────────────────────────────────────────
  server.tool(
    'jobscan_list_parsers',
    'List all available ATS parser names supported by JobScan. Use the returned names when calling jobscan_add_source or jobscan_detect_source.',
    {},
    { readOnlyHint: true, openWorldHint: true },
    async () => {
      try {
        const result = await jobscanFetch<string[]>('/api/sources/parsers');
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_list_sources ──────────────────────────────────────────────────
  server.tool(
    'jobscan_list_sources',
    'List all tracked career page sources with their sync status and job counts. Returns paginated results.',
    {
      page: z.number().int().positive().optional().default(1).describe('Page number (default: 1).'),
      pageSize: z.number().int().min(1).max(100).optional().default(25).describe('Results per page (default: 25, max: 100).'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ page, pageSize }) => {
      try {
        const result = await jobscanFetch<{ total: number }>(`/api/sources?page=${page}&pageSize=${pageSize}`);
        if (result.total === 0) {
          return {
            content: [{ type: 'text', text: 'No sources configured. Use jobscan_add_source to add your first career page.' }],
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_delete_source ─────────────────────────────────────────────────
  server.tool(
    'jobscan_delete_source',
    'Remove a tracked source by its ID. Previously scraped jobs are NOT deleted. Use jobscan_list_sources to find the source ID.',
    {
      sourceId: z.number().int().positive().describe('The numeric ID of the source to remove.'),
    },
    { destructiveHint: true, openWorldHint: true },
    async ({ sourceId }) => {
      try {
        const result = await jobscanFetch(`/api/sources/${sourceId}`, { method: 'DELETE' });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404')) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Source not found: ID ${sourceId}. Use jobscan_list_sources to see valid IDs.`,
              },
            ],
          };
        }
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );
}
