import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jobscanFetch } from './api.js';
import type { CrmJob, CrmBucketCounts, CrmStatusMap, Paginated } from './types.js';

// T019: jobscan_crm_add_jobs     (US4)
// T020: jobscan_crm_status_map   (US4)
// T022: jobscan_crm_list_jobs    (US5)
// T023: jobscan_crm_get_job      (US5)
// T024: jobscan_crm_move_job     (US5)
// T025: jobscan_crm_comment      (US5)
// T026: jobscan_crm_delete_job   (US5)
// T028: jobscan_crm_counts       (US6)
// T029: jobscan_crm_funnel       (US6)

const BUCKET_ENUM = z.enum([
  'sourced',
  'filtered',
  'processed',
  'applied',
  'disqualified',
  'auto_disqualified',
]);

export function registerCrmTools(server: McpServer): void {
  // ─── jobscan_crm_add_jobs ──────────────────────────────────────────────────
  server.tool(
    'jobscan_crm_add_jobs',
    'Add one or more jobs to the CRM pipeline. Provide an array of job IDs from jobscan_search_jobs. Returns how many were added vs skipped (already in CRM). Defaults to the "sourced" bucket.',
    {
      jobIds: z.array(z.number().int().positive()).min(1).describe('Array of job IDs to add to the CRM pipeline.'),
      bucket: BUCKET_ENUM.optional().default('sourced').describe('Target CRM bucket (default: sourced).'),
      comment: z.string().optional().describe('Optional comment to attach when adding.'),
      reason: z.string().optional().describe('Required when adding to disqualified or auto_disqualified bucket.'),
    },
    { openWorldHint: true },
    async ({ jobIds, bucket, comment, reason }) => {
      try {
        const body: Record<string, unknown> = { jobIds, bucket };
        if (comment !== undefined) body['comment'] = comment;
        if (reason !== undefined) body['reason'] = reason;

        const result = await jobscanFetch<{ added: number; skipped: number }>('/api/crm/jobs', {
          method: 'POST',
          body: JSON.stringify(body),
        });

        if (result.added === 0 && result.skipped > 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No valid job IDs found. All ${result.skipped} provided IDs were skipped (already in CRM or not found).`,
              },
            ],
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('400') && (msg.includes('reason') || msg.includes('disqualified'))) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: "reason is required when adding to 'disqualified' or 'auto_disqualified' bucket.",
              },
            ],
          };
        }
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_crm_status_map ────────────────────────────────────────────────
  server.tool(
    'jobscan_crm_status_map',
    'Bulk CRM status lookup for a list of job IDs. Returns a map of job ID to CRM bucket for jobs that are in the pipeline. Jobs not in the CRM are absent from the result. Useful for annotating search results.',
    {
      jobIds: z.array(z.number().int().positive()).min(1).describe('Array of job IDs to check CRM status for.'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ jobIds }) => {
      try {
        const result = await jobscanFetch<CrmStatusMap>(
          `/api/crm/jobs/status-map?jobIds=${jobIds.join(',')}`,
        );
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_crm_list_jobs ─────────────────────────────────────────────────
  server.tool(
    'jobscan_crm_list_jobs',
    'List jobs in a specific CRM pipeline bucket with optional filters. Returns paginated CRM job records with joined job fields (company, title, location, etc.) but without event history.',
    {
      bucket: BUCKET_ENUM.describe('The CRM bucket to list jobs from (required).'),
      page: z.number().int().positive().optional().default(1).describe('Page number (default: 1).'),
      pageSize: z.number().int().min(1).max(100).optional().default(25).describe('Results per page (default: 25, max: 100).'),
      company: z.string().optional().describe('Filter by company name.'),
      title: z.string().optional().describe('Filter by job title.'),
      location: z.string().optional().describe('Filter by location.'),
      search: z.string().optional().describe('Full-text search across title and company.'),
      searchMode: z.enum(['fuzzy', 'exact', 'regex']).optional().default('fuzzy').describe('Search mode (default: fuzzy).'),
      brief: z.boolean().optional().default(true).describe('Omit full job description from results to reduce payload size (default: true). Set to false to include descriptions.'),
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
        const result = await jobscanFetch<Paginated<CrmJob>>(`/api/crm/jobs?${query.toString()}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_crm_get_job ───────────────────────────────────────────────────
  server.tool(
    'jobscan_crm_get_job',
    'Get full details for a CRM pipeline job, including its complete event history timeline (added, moved, commented, processed events). Use jobscan_crm_list_jobs to find CRM job IDs.',
    {
      crmJobId: z.number().int().positive().describe('The numeric CRM job ID.'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ crmJobId }) => {
      try {
        const result = await jobscanFetch<CrmJob>(`/api/crm/jobs/${crmJobId}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404')) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `CRM job not found: ID ${crmJobId}. Use jobscan_crm_list_jobs to find valid IDs.`,
              },
            ],
          };
        }
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_crm_move_job ──────────────────────────────────────────────────
  server.tool(
    'jobscan_crm_move_job',
    'Move a CRM job to a different pipeline bucket (e.g. from sourced to applied). Optionally attach a comment. A reason is required when moving to disqualified or auto_disqualified.',
    {
      crmJobId: z.number().int().positive().describe('The numeric CRM job ID to move.'),
      bucket: BUCKET_ENUM.describe('The target bucket to move the job to.'),
      comment: z.string().optional().describe('Optional comment to attach to the move event.'),
    },
    { openWorldHint: true },
    async ({ crmJobId, bucket, comment }) => {
      try {
        const body: Record<string, unknown> = { bucket };
        if (comment !== undefined) body['comment'] = comment;

        const result = await jobscanFetch(`/api/crm/jobs/${crmJobId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404')) {
          return {
            isError: true,
            content: [{ type: 'text', text: `CRM job not found: ID ${crmJobId}.` }],
          };
        }
        if (msg.includes('400') && (msg.includes('reason') || msg.includes('disqualified'))) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: "reason is required when moving to 'disqualified' or 'auto_disqualified'.",
              },
            ],
          };
        }
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_crm_comment ───────────────────────────────────────────────────
  server.tool(
    'jobscan_crm_comment',
    'Set or clear the user comment on a CRM pipeline job. Pass null to remove an existing comment.',
    {
      crmJobId: z.number().int().positive().describe('The numeric CRM job ID.'),
      comment: z.string().nullable().describe('Comment text to set, or null to clear the existing comment.'),
    },
    { openWorldHint: true },
    async ({ crmJobId, comment }) => {
      try {
        const result = await jobscanFetch(`/api/crm/jobs/${crmJobId}`, {
          method: 'PATCH',
          body: JSON.stringify({ comment }),
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404')) {
          return {
            isError: true,
            content: [{ type: 'text', text: `CRM job not found: ID ${crmJobId}.` }],
          };
        }
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_crm_delete_job ────────────────────────────────────────────────
  server.tool(
    'jobscan_crm_delete_job',
    'Remove a job from the CRM pipeline. The underlying scraped job listing is NOT deleted — only the CRM entry (bucket, tier, events) is removed.',
    {
      crmJobId: z.number().int().positive().describe('The numeric CRM job ID to remove from the pipeline.'),
    },
    { destructiveHint: true, openWorldHint: true },
    async ({ crmJobId }) => {
      try {
        const result = await jobscanFetch(`/api/crm/jobs/${crmJobId}`, { method: 'DELETE' });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404')) {
          return {
            isError: true,
            content: [{ type: 'text', text: `CRM job not found: ID ${crmJobId}.` }],
          };
        }
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_crm_counts ────────────────────────────────────────────────────
  server.tool(
    'jobscan_crm_counts',
    'Get the number of jobs in each CRM pipeline bucket. Accepts optional filters to narrow the count (e.g. count only jobs from a specific company). Useful for pipeline health summaries.',
    {
      company: z.string().optional().describe('Filter by company name.'),
      title: z.string().optional().describe('Filter by job title.'),
      location: z.string().optional().describe('Filter by location.'),
      search: z.string().optional().describe('Full-text search filter.'),
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
        const qs = query.toString();
        const result = await jobscanFetch<CrmBucketCounts>(
          `/api/crm/jobs/counts${qs ? `?${qs}` : ''}`,
        );
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_crm_funnel ────────────────────────────────────────────────────
  server.tool(
    'jobscan_crm_funnel',
    'Get CRM pipeline funnel analytics showing transition rates and filter pass rates between buckets. Useful for understanding how effective the sourcing and filtering process is.',
    {
      company: z.string().optional().describe('Filter by company name.'),
      title: z.string().optional().describe('Filter by job title.'),
      location: z.string().optional().describe('Filter by location.'),
      search: z.string().optional().describe('Full-text search filter.'),
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
        const qs = query.toString();
        const result = await jobscanFetch(`/api/crm/analytics/funnel${qs ? `?${qs}` : ''}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );
}
