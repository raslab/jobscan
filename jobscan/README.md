# JobScan

A self-hosted careers-page aggregator and job-search CRM. Add company job-board URLs, scrape them on demand, browse/filter collected job listings, and move selected roles through a lightweight CRM pipeline.

JobScan is designed for a trusted self-hosted environment. For remote deployments, put it behind `oauth2-proxy` or another authenticated reverse proxy and TLS terminator.

This started as a personal project used daily for a few months. It intentionally has no separate frontend app or frontend build pipeline: the UI is plain, ugly, server-served HTML/CSS/JS so the whole thing stays simple to deploy and operate on a small VM.

Current real-world target scale is roughly 10k sources across many ATSes/custom boards, daily sync, up to about 1m cached jobs, and about 20k CRM jobs on a small 1 vCPU / 2 GB RAM cloud VM. Treat that as practical operating context, not a formal benchmark.

## Requirements

| Tool | Min version |
|------|-------------|
| Node.js | 22.5+ (built-in `node:sqlite` is used for local SQLite mode) |
| npm | 10+ recommended |
| Docker + Compose | recommended for VM deployment |

## Quick start: local development

```bash
npm ci --include=dev
npm run dev
```

Open `http://localhost:3000`.

Local development uses SQLite by default and creates `data/jobscan.db` on first run.

## Docker deployment

```bash
cp .env.example .env
cp emails.example.txt emails.txt
cp htpasswd.example htpasswd
# Edit .env, emails.txt, and htpasswd before starting.
docker compose up --build -d
```

The included compose file runs:

- PostgreSQL for persistent data
- JobScan on the internal Docker network
- oauth2-proxy exposed on host port `3050`

Stop:

```bash
docker compose down
```

Data is persisted in the `pgdata` Docker volume.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` local / `3050` Docker | HTTP port the app listens on |
| `DATABASE_URL` | unset | When set, JobScan uses PostgreSQL; otherwise SQLite |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Optional Gemini model override |
| `POSTGRES_DB` | from `.env` | Docker Postgres database name |
| `POSTGRES_USER` | from `.env` | Docker Postgres user |
| `POSTGRES_PASSWORD` | from `.env` | Docker Postgres password |
| `GOOGLE_CLIENT_ID` | from `.env` | oauth2-proxy Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | from `.env` | oauth2-proxy Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | from `.env` | OAuth callback URL, e.g. `https://jobscan.example.com/oauth2/callback` |
| `COOKIE_SECRET` | from `.env` | oauth2-proxy cookie secret |

## Auth model

The app does not implement user accounts. Remote deployments should expose only the oauth2-proxy port and keep the JobScan app port internal to Docker.

API clients such as MCP can authenticate through oauth2-proxy using the `htpasswd` file. Generate a real credential with:

```bash
htpasswd -nbB mcp '<strong-password>' > htpasswd
```

Never commit real `emails.txt`, `htpasswd`, `.env`, databases, logs, or local MCP configs.

## Using the app

1. Add a source in the Sources tab.
2. Pick a parser or use source detection.
3. Sync all sources or a single source.
4. Browse/search jobs.
5. Add promising jobs to CRM.
6. Use CRM filters and Gemini-assisted processing if configured.

## Project layout

```text
jobscan/
├── src/
│   ├── index.ts          # Express app entry point
│   ├── db/               # SQLite/Postgres adapter boundary
│   ├── migrations/       # SQLite and Postgres migrations
│   ├── parsers/          # ATS parsers and detection registry
│   ├── routes/           # REST API routes: sources, jobs, sync, CRM
│   ├── public/           # Static frontend
│   ├── scraper.ts        # Fetch + parser dispatch
│   ├── sync.ts           # Sync orchestration
│   ├── processing.ts     # CRM auto-processing queue
│   └── llm.ts            # Gemini client
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── emails.example.txt
├── htpasswd.example
└── package.json
```

## API reference: high level

| Area | Paths |
|------|-------|
| Sources | `/api/sources`, `/api/sources/detect`, `/api/sources/parsers` |
| Jobs | `/api/jobs`, `/api/jobs/stats`, `/api/jobs/filter-options` |
| Sync | `/api/sync`, `/api/sync/start`, `/api/sync/complete`, `/api/sync/:sourceId` |
| CRM | `/api/crm/jobs`, `/api/crm/filters`, `/api/crm/settings`, `/api/crm/process`, `/api/crm/analytics/funnel` |

## Development

```bash
npm ci --include=dev
npm run build
```

Parser fixture caches are intentionally not committed. Regenerate them when needed with the helper under `src/__tests__/helpers/`.

The full Jest suite also includes integration tests that expect a dev server on
`localhost:3000`. Start `npm run dev` in another shell before running those.
