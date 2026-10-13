# Contributing

Thanks for considering a contribution to JobScan.

## Local setup

From the repository root, the canonical checks are bound as npm scripts:

```bash
npm run check:env    # bootstrap: Postgres + jobscan install/build + dev server on :3000
npm run check        # build, unit tests, full tests, MCP build/tests
```

Individual steps: `npm run check:build`, `npm run check:unit`, `npm run check:full`, `npm run check:mcp`. `check:env` runs `tools/canonical-check.sh` (idempotent; container-local DB credentials only).

The app requires Node.js 22.5+ because it uses built-in `node:sqlite` for local SQLite mode. The MCP package supports Node.js 20+.

The full JobScan Jest suite uses the checked-in parser fixtures under `jobscan/src/__tests__/fixtures/` and integration tests that expect a running dev server; `npm run check:env` starts it. See `jobscan/LIVE-FIXTURES.md` for the opt-in fixture refresh path.

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
