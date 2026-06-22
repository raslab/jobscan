# JobScan MCP Server

An MCP (Model Context Protocol) server that wraps the [JobScan](../jobscan/) REST API, exposing 20 tools so AI assistants (Claude Desktop, Claude Code, Cursor, etc.) can interact with your job tracking system through natural language.

---

## Prerequisites

- Node.js 20+
- JobScan running (default: `http://localhost:3000`)
- An MCP-compatible AI client

---

## Build

```bash
cd jobscan-mcp
npm install
npm run build
# Output: dist/index.js
```

For development (no compile step):

```bash
npm run dev
```

---

## Quick Smoke Test

```bash
JOBSCAN_URL=http://localhost:3000 node dist/index.js
```

The server starts silently and waits for stdin. Press `Ctrl+C` to exit.

---

## Configure in Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "jobscan": {
      "command": "node",
      "args": ["/absolute/path/to/jobscan-mcp/dist/index.js"],
      "env": {
        "JOBSCAN_URL": "http://localhost:3000",
        "JOBSCAN_AUTH_TOKEN": "Basic <base64(user:password)>"
      }
    }
  }
}
```

> **Local dev (no auth proxy):** omit `JOBSCAN_AUTH_TOKEN` or leave it empty.

Restart Claude Desktop. The `jobscan_*` tools will appear in the tools panel.

---

## Configure in Claude Code

Create or edit `.claude/mcp.json` in your project root or home directory:

```json
{
  "mcpServers": {
    "jobscan": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/jobscan-mcp",
      "env": {
        "JOBSCAN_URL": "https://jobscan.example.com",
        "JOBSCAN_AUTH_TOKEN": "Basic <base64(user:password)>"
      }
    }
  }
}
```

Or add via CLI:

```bash
claude mcp add jobscan \
  --command "node" \
  --args "dist/index.js" \
  --cwd "/path/to/jobscan-mcp" \
  --env "JOBSCAN_URL=https://jobscan.example.com" \
  --env "JOBSCAN_AUTH_TOKEN=Basic <base64(user:password)>"
```

---

## Configure in Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "jobscan": {
      "command": "node",
      "args": ["/absolute/path/to/jobscan-mcp/dist/index.js"],
      "env": {
        "JOBSCAN_URL": "https://jobscan.example.com",
        "JOBSCAN_AUTH_TOKEN": "Basic <base64(user:password)>"
      }
    }
  }
}
```

---

## Verify Connection

Ask your AI assistant:

> "List available jobscan tools"

Then try an end-to-end flow:

> "Add Stripe's careers page to JobScan — https://boards.greenhouse.io/stripe"

Expected steps:
1. Assistant calls `jobscan_detect_source` → detects `parser: greenhouse, company: Stripe`
2. Assistant calls `jobscan_add_source` → registers source, returns first-scrape count
3. Assistant reports: "Added Stripe — found N open positions using the greenhouse parser."

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JOBSCAN_URL` | `http://localhost:3000` | Base URL of the running JobScan instance |
| `JOBSCAN_AUTH_TOKEN` | _(none)_ | Full `Authorization` header value sent on every request (see below) |

---

## Authentication (remote / OAuth-proxy deployments)

When JobScan is deployed behind an OAuth proxy (e.g. `https://jobscan.example.com/`), the MCP server needs to authenticate every API request.

### 1 — Generate credentials on the server

SSH into the GCP VM and run:

```bash
# Install htpasswd if needed
sudo apt-get install -y apache2-utils   # Debian/Ubuntu
# sudo yum install -y httpd-tools       # RHEL/CentOS

# Generate a bcrypt hash for the "mcp" user
htpasswd -nbB mcp <your-strong-password>
# Output example:  mcp:$2y$05$abc123...
```

Paste the output line into `jobscan/htpasswd` (replace the placeholder), then restart the proxy:

```bash
docker compose restart oauth2-proxy
```

### 2 — Build the Authorization header value locally

```bash
echo -n "mcp:<your-strong-password>" | base64
# Output: <base64-output>
```

The token you need is `Basic <base64-output>`, e.g.:

```
Basic <base64-output>
```

### 3 — Set JOBSCAN_AUTH_TOKEN in your MCP config

#### Claude Desktop

```json
{
  "mcpServers": {
    "jobscan": {
      "command": "node",
      "args": ["/absolute/path/to/jobscan-mcp/dist/index.js"],
      "env": {
        "JOBSCAN_URL": "https://jobscan.example.com",
        "JOBSCAN_AUTH_TOKEN": "Basic <base64-output>"
      }
    }
  }
}
```

#### Claude Code / Cursor

```json
{
  "mcpServers": {
    "jobscan": {
      "command": "node",
      "args": ["/absolute/path/to/jobscan-mcp/dist/index.js"],
      "env": {
        "JOBSCAN_URL": "https://jobscan.example.com",
        "JOBSCAN_AUTH_TOKEN": "Basic <base64-output>"
      }
    }
  }
}
```

> **Tip:** `JOBSCAN_AUTH_TOKEN` accepts any `Authorization` header value.
> Use `Basic <base64>` for htpasswd-style auth (recommended) or `Bearer <token>` if you configure a different scheme.

---

## Available Tools (20 total)

### Sources (5 tools)
| Tool | Description |
|------|-------------|
| `jobscan_list_sources` | List all tracked career pages |
| `jobscan_detect_source` | Auto-detect parser from a careers URL |
| `jobscan_add_source` | Register a new source and trigger first scrape |
| `jobscan_delete_source` | Remove a source by ID |
| `jobscan_list_parsers` | List all supported ATS parser names |

### Jobs (3 tools)
| Tool | Description |
|------|-------------|
| `jobscan_search_jobs` | Search/filter jobs with pagination |
| `jobscan_get_job` | Get full job details including Markdown description |
| `jobscan_get_stats` | Aggregate stats (counts, companies, locations, etc.) |

### Sync (3 tools)
| Tool | Description |
|------|-------------|
| `jobscan_sync_all` | Sync all sources for new jobs |
| `jobscan_sync_source` | Sync a single source by ID |
| `jobscan_sync_latest` | Get info on the most recent sync |

### CRM Pipeline (9 tools)
| Tool | Description |
|------|-------------|
| `jobscan_crm_add_jobs` | Add jobs to the pipeline |
| `jobscan_crm_status_map` | Bulk CRM status lookup for job IDs |
| `jobscan_crm_list_jobs` | List jobs in a pipeline bucket |
| `jobscan_crm_get_job` | Get full CRM job details + event history |
| `jobscan_crm_move_job` | Move a job to a different bucket |
| `jobscan_crm_comment` | Set or clear a comment on a CRM job |
| `jobscan_crm_delete_job` | Remove a job from the pipeline |
| `jobscan_crm_counts` | Count jobs per bucket (with optional filters) |
| `jobscan_crm_funnel` | Pipeline funnel analytics |

---

## Troubleshooting

**Server doesn't start**: Ensure `npm run build` succeeds first and `dist/index.js` exists.

**Tool calls fail with connection errors**: Check that `JOBSCAN_URL` points to a running JobScan instance (`curl $JOBSCAN_URL/api/jobs/stats`).

**"Cannot detect parser" errors**: Use `jobscan_list_parsers` to see supported parsers, then call `jobscan_add_source` with `parser='default'` for unsupported ATS platforms.

---

## Project Structure

```
jobscan-mcp/
├── package.json          # name: jobscan-mcp; type: module
├── tsconfig.json         # strict: true; module: Node16
├── src/
│   ├── index.ts          # Entry: McpServer setup, tool registration, stdio transport
│   ├── api.ts            # jobscanFetch<T>() wrapper with error handling
│   ├── types.ts          # Shared interfaces (Source, Job, CrmJob, …)
│   ├── sources.ts        # 5 source tools (detect, add, list, delete, parsers)
│   ├── jobs.ts           # 3 job tools (search, get, stats)
│   ├── sync.ts           # 3 sync tools (all, source, latest)
│   └── crm.ts            # 9 CRM tools (add, status_map, list, get, move, comment, delete, counts, funnel)
└── dist/                 # tsc output (gitignored)
```
