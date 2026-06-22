import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerSourcesTools } from './sources.js';
import { registerSyncTools } from './sync.js';
import { registerJobsTools } from './jobs.js';
import { registerCrmTools } from './crm.js';

const server = new McpServer({
  name: 'jobscan',
  version: '1.0.0',
});

registerSourcesTools(server);
registerSyncTools(server);
registerJobsTools(server);
registerCrmTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
