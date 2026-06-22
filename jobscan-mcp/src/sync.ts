import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jobscanFetch } from './api.js';
import type { SyncAllResult, SyncLog } from './types.js';

// T011: jobscan_sync_all
// T012: jobscan_sync_source
// T013: jobscan_sync_latest

export function registerSyncTools(server: McpServer): void {
  // ─── jobscan_sync_all ──────────────────────────────────────────────────────
  server.tool(
    'jobscan_sync_all',
    'Trigger a full sync of all configured career page sources. Scrapes every tracked source for new jobs and returns a summary with per-source results. May take 10–60 seconds depending on the number of sources.',
    {},
    { openWorldHint: true },
    async () => {
      try {
        const result = await jobscanFetch<SyncAllResult>('/api/sync', { method: 'POST' });
        if (result.sourcesChecked === 0) {
          return {
            content: [{ type: 'text', text: 'No sources configured. Use jobscan_add_source to add a career page first.' }],
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_sync_source ───────────────────────────────────────────────────
  server.tool(
    'jobscan_sync_source',
    'Sync a single career page source by its ID. Returns the number of new jobs found and the sync status. Use jobscan_list_sources to find valid source IDs.',
    {
      sourceId: z.number().int().positive().describe('The numeric ID of the source to sync.'),
    },
    { openWorldHint: true },
    async ({ sourceId }) => {
      try {
        const result = await jobscanFetch<Record<string, unknown>>(`/api/sync/${sourceId}`, { method: 'POST' });
        // The sync endpoint always returns 200 now; check payload for errors
        if (result.status === 'error') {
          const errMsg = String(result.error || 'Unknown sync error');
          if (errMsg.includes('Source not found')) {
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
          return { isError: true, content: [{ type: 'text', text: errMsg }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );

  // ─── jobscan_sync_latest ───────────────────────────────────────────────────
  server.tool(
    'jobscan_sync_latest',
    'Get information about the most recently completed sync session: when it ran, how many sources were checked, and how many new jobs were found.',
    {},
    { readOnlyHint: true, openWorldHint: true },
    async () => {
      try {
        const result = await jobscanFetch<SyncLog | null>('/api/sync/latest');
        if (result === null) {
          return { content: [{ type: 'text', text: 'No sync has been run yet.' }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text', text: msg }] };
      }
    },
  );
}
