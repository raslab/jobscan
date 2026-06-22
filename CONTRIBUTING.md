# Contributing

Thanks for considering a contribution to JobScan.

## Local setup

```bash
cd jobscan
npm ci
npm run build

cd ../jobscan-mcp
npm ci
npm run build
npm test
```

The app requires Node.js 22.5+ because it uses built-in `node:sqlite` for local SQLite mode. The MCP package supports Node.js 20+.

The full JobScan Jest suite includes parser tests that need generated fixtures and integration tests that expect a running dev server. Generate fixtures and start `npm run dev` before running the full suite.

## Pull requests

Please keep PRs focused. Good PRs include:

- a short description of the problem
- screenshots for UI changes
- tests or a clear manual verification note
- parser fixtures/tests for parser behavior changes when practical

## Security and private data

Do not commit:

- `.env` files
- real `emails.txt` or `htpasswd`
- local MCP client configs
- SQLite/Postgres dumps
- scraped production data
- private source lists or scratch files
- API keys, tokens, cookies, or credentials

Use the example files instead.
