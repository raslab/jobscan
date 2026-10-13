#!/usr/bin/env bash
# Canonical-check bootstrap for jobscan worker sandboxes (node:22-bookworm).
# Run from the repository root (or anywhere; paths are repo-relative to this
# script) before the 4 canonical checks.
# Idempotent: safe to re-run in a sticky persistent container.
#
# Postgres: prefers PostgreSQL 16 from the official PGDG apt repo
# (apt.postgresql.org) to match jobscan/docker-compose.yml's postgres:16-alpine.
# If the PGDG repo is unreachable, it falls back to the distro postgresql
# package (Debian bookworm ships PostgreSQL 15) and prints the version used.
#
# Credential model: only generated container-local DB credentials are used
# (defaults jobscan/jobscan/jobscan, overridable via DB_USER/DB_PASSWORD/
# DB_NAME). No real tokens or secrets are read, written or committed.
#
# Canonical checks (bound to npm scripts in the root package.json):
#   1. main-build:       cd jobscan && npm ci --include=dev --no-audit --no-fund && npm run build
#   2. main-full-tests:  cd jobscan && npm test -- --runInBand          (needs postgres + dev server)
#   3. main-unit-tests:  cd jobscan && npm run test:unit -- --runInBand (no services needed)
#   4. mcp-build-tests:  cd jobscan-mcp && npm ci --include=dev --no-audit --no-fund && npm run build && npm test
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
# Single source of truth for the container-local DB credentials: the URL and
# the SQL role creation MUST use the same value (a literal "***" placeholder
# in the URL caused 28P01 auth_failed against the real role password).
DB_USER="${DB_USER:-jobscan}"
DB_PASSWORD="${DB_PASSWORD:-jobscan}"
DB_NAME="${DB_NAME:-jobscan}"
case "$DB_USER$DB_PASSWORD$DB_NAME" in
  *[!A-Za-z0-9_]*) echo "DB_USER/DB_PASSWORD/DB_NAME must be [A-Za-z0-9_]+" >&2; exit 1;;
esac
export DATABASE_URL="${DATABASE_URL:-postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME}"

# 1. Postgres: try PGDG (apt.postgresql.org) for postgresql-16 to match
# docker-compose's postgres:16-alpine; fall back to distro postgresql.
if ! command -v psql >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates gnupg
fi
if ! command -v psql >/dev/null 2>&1; then
  PGDG_OK=0
  if curl -fsS --max-time 30 -o /tmp/pgdg.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc; then
    install -m 0644 /tmp/pgdg.asc /etc/apt/keyrings/postgresql.asc 2>/dev/null \
      || { mkdir -p /etc/apt/keyrings && install -m 0644 /tmp/pgdg.asc /etc/apt/keyrings/postgresql.asc; }
    . /etc/os-release
    echo "deb [signed-by=/etc/apt/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME:-bookworm}-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list
    if apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-16 postgresql-client-16; then
      PGDG_OK=1
    fi
  fi
  if [ "$PGDG_OK" != 1 ]; then
    echo "PGDG postgresql-16 unavailable; falling back to distro postgresql (Debian bookworm ships PostgreSQL 15)" >&2
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-client
  fi
fi
PGVER="$(psql --version | sed -E 's/.* ([0-9]+)(\.[0-9]+)?.*/\1/')"
echo "Using PostgreSQL major version: $PGVER"
service postgresql start >/dev/null 2>&1 || pg_ctlcluster "$PGVER" main start || true
su postgres -c "cd / && psql -tAc \"select 1 from pg_roles where rolname='$DB_USER'\"" | grep -q 1 || \
  su postgres -c "cd / && psql -c \"CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';\" -c \"CREATE DATABASE $DB_NAME OWNER $DB_USER;\""

# 2. Install + build (check 1)
cd "$REPO/jobscan"
npm ci --include=dev --no-audit --no-fund
npm run build

# 3. Dev server on :3000 against Postgres (required by main-full-tests)
if ! curl -sf -o /dev/null http://localhost:3000/api/sources/parsers; then
  nohup npm run dev > /tmp/jobscan-dev.log 2>&1 &
  for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3000/api/sources/parsers && break; sleep 1; done
  curl -sf -o /dev/null http://localhost:3000/api/sources/parsers || { echo "dev server failed to start"; tail -20 /tmp/jobscan-dev.log; exit 1; }
fi

# 4. Check-environment handoff: controllers that re-run the canonical checks in
# their own env -i shells source this file to get the container-local
# DATABASE_URL (never forwarded from the host).
CHECK_ENV_FILE="${CHECK_ENV_FILE:-/home/coder/.canonical-check-env}"
mkdir -p "$(dirname "$CHECK_ENV_FILE")"
printf 'export DATABASE_URL=%s\n' "$(printf '%q' "$DATABASE_URL")" > "$CHECK_ENV_FILE"

# BOOTSTRAP_ONLY=1 stops after services are ready (used by the runner wiring;
# the controller then re-runs the checks itself via docker exec).
if [ "${BOOTSTRAP_ONLY:-0}" = 1 ]; then
  echo "canonical-check bootstrap complete (postgres + build + dev server ready; checks skipped)"
  exit 0
fi

# 5. Checks 2-4 (same commands as the root package.json check:* scripts)
npm test -- --runInBand
npm run test:unit -- --runInBand
cd "$REPO/jobscan-mcp"
npm ci --include=dev --no-audit --no-fund
npm run build
npm test
