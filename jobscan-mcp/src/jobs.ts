import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jobscanFetch } from './api.js';
import type { Job, JobStats, Paginated } from './types.js';

// T015: jobscan_search_jobs
// T016: jobscan_get_job
// T017: jobscan_get_stats

export function registerJobsTools(server: McpServer): void {
  // ─── jobscan_search_jobs ───────────────────────────────────────────────────
  server.tool(
    'jobscan_search_jobs',
    'Search and filter scraped job listings. Returns paginated results without full descriptions. Use jobscan_get_job to fetch the full description for a specific job. Supports fuzzy, exact, and regex search modes.',
    {
      company: z.string().optional().describe('Filter by company name (partial match).'),
      title: z.string().optional().describe('Filter by job title (partial match).'),
      location: z.string().optional().describe('Filter by location (partial match).'),
      department: z.string().optional().describe('Filter by department name.'),
      workplace_type: z.string().optional().describe('Filter by workplace type: remote, hybrid, or onsite.'),
      commitment: z.string().optional().describe('Filter by commitment type: full-time, part-time, or contract.'),
      search: z.string().optional().describe('Full-text search across title and description.'),
      searchMode: z.enum(['fuzzy', 'exact', 'regex']).optional().default('fuzzy').describe('Search mode for the search field (default: fuzzy).'),
      syncId: z.number().int().positive().optional().describe('Filter jobs discovered in a specific sync.'),
      inCrm: z.enum(['yes', 'no']).optional().describe('Filter by CRM presence: yes (in pipeline) or no (not in pipeline).'),
      page: z.number().int().positive().optional().default(1).describe('Page number (default: 1).'),
      pageSize: z.number().int().min(1).max(100).optional().default(25).describe('Results per page (default: 25, max: 100).'),
      sortBy: z.string().optional().describe('Field to sort by (e.g. first_seen, title).'),
      sortDir: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort direction (default: desc).'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async (params) => {
      try {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null) {
            query.set(key, String(value));
          }
        }
        const result = await jobscanFetch<Paginated<Job>>(`/api/jobs?${query.toString()}`);
        if (result.total === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No jobs found matching the given filters. Try broadening your search or use jobscan_sync_all to fetch new jobs.',
              },
            ],
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('400') && msg.toLowerCase().includes('regex')) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Invalid regex pattern in 'search': ${msg}` }],
          };
        }
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_get_job ───────────────────────────────────────────────────────
  server.tool(
    'jobscan_get_job',
    'Get full job details including the Markdown-formatted description. Use jobscan_search_jobs first to find job IDs, then call this to read the full job description for analysis.',
    {
      jobId: z.number().int().positive().describe('The numeric job ID to retrieve.'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ jobId }) => {
      try {
        const result = await jobscanFetch<Job>(`/api/jobs/${jobId}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404')) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Job not found: ID ${jobId}. Use jobscan_search_jobs to find valid job IDs.`,
              },
            ],
          };
        }
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_get_stats ─────────────────────────────────────────────────────
  server.tool(
    'jobscan_get_stats',
    'Get aggregate statistics about all scraped jobs: total counts, distinct companies, locations, departments, workplace types, and commitment types. Useful for understanding the overall job landscape.',
    {},
    { readOnlyHint: true, openWorldHint: true },
    async () => {
      try {
        const result = await jobscanFetch<JobStats>('/api/jobs/stats?includeFilters=true');
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );
}
