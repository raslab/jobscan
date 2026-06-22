// Typed fetch wrapper for the JobScan REST API.
// Reads base URL from JOBSCAN_URL environment variable (default: http://localhost:3000).
//
// Authentication
// ─────────────
// When the JobScan instance is behind an OAuth proxy (e.g. oauth2-proxy on GCP),
// set JOBSCAN_AUTH_TOKEN to the full value of the Authorization header you want
// to send with every request:
//
//   Basic auth  →  JOBSCAN_AUTH_TOKEN="Basic <base64(user:password)>"
//   Bearer auth →  JOBSCAN_AUTH_TOKEN="Bearer <token>"
//
// For Basic auth you can generate the value with:
//   echo -n "user:password" | base64   →  then prefix "Basic "
//
// See the README for how to configure the matching htpasswd on the server side.

const BASE_URL = process.env['JOBSCAN_URL'] ?? 'http://localhost:3000';
const AUTH_TOKEN = process.env['JOBSCAN_AUTH_TOKEN'];

export async function jobscanFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;

  const authHeaders: Record<string, string> = AUTH_TOKEN
    ? { Authorization: AUTH_TOKEN }
    : {};

  const response = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(opts?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let body = '';
    try {
      body = await response.text();
    } catch {
      // ignore body read errors
    }
    throw new Error(`JobScan API error ${response.status} ${response.statusText}: ${body}`);
  }

  return response.json() as Promise<T>;
}
