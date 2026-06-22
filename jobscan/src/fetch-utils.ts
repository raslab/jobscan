/**
 * Shared HTTP fetch utilities with User-Agent rotation, proper browser headers,
 * and exponential backoff retry for rate-limit / block status codes.
 */

// ── User-Agent rotation ───────────────────────────────────────────────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function browserHeaders(accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'): Record<string, string> {
  return {
    'User-Agent': randomUA(),
    'Accept': accept,
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random delay between min and max milliseconds */
export function randomDelay(minMs = 2000, maxMs = 5000): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return sleep(ms);
}

// HTTP status codes that trigger exponential backoff retry
const RETRYABLE_STATUSES = new Set([401, 403, 406, 429, 503]);
const MAX_RETRIES = 10;

// ── Fetch with exponential backoff retry ──────────────────────────────────────
interface FetchResult<T> {
  data: T;
  error?: string;
}

async function fetchWithRetry(
  url: string,
  options: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxRetries?: number;
    method?: 'GET' | 'POST';
    body?: string;
    parseAs: 'text';
  }
): Promise<FetchResult<string>>;
async function fetchWithRetry(
  url: string,
  options: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxRetries?: number;
    method?: 'GET' | 'POST';
    body?: string;
    parseAs: 'json';
  }
): Promise<FetchResult<unknown>>;
async function fetchWithRetry(
  url: string,
  options: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxRetries?: number;
    method?: 'GET' | 'POST';
    body?: string;
    parseAs: 'text' | 'json';
  }
): Promise<FetchResult<unknown>> {
  const { headers = {}, timeoutMs = 15_000, parseAs, maxRetries = MAX_RETRIES, method = 'GET', body } = options;
  let lastError = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 2s, 4s, 8s, 16s, ... capped at 120s
      const backoffMs = Math.min(2000 * Math.pow(2, attempt - 1), 120_000);
      // Add jitter: ±25%
      const jitter = backoffMs * (0.75 + Math.random() * 0.5);
      console.log(`[fetch] Retry ${attempt}/${maxRetries} for ${url} — waiting ${Math.round(jitter / 1000)}s`);
      await sleep(jitter);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        body,
        signal: AbortSignal.timeout(timeoutMs),
        headers: { ...browserHeaders(parseAs === 'json' ? 'application/json, */*;q=0.5' : undefined), ...headers },
      });
    } catch (err) {
      lastError = `Network error: ${String(err)}`;
      // Network errors are also retryable (timeout, DNS, etc.)
      if (attempt < maxRetries) continue;
      return { data: parseAs === 'json' ? null : '', error: lastError } as FetchResult<unknown>;
    }

    if (RETRYABLE_STATUSES.has(response.status)) {
      lastError = `HTTP ${response.status} ${response.statusText}`;
      if (attempt < maxRetries) {
        console.log(`[fetch] Got ${response.status} for ${url}`);
        continue;
      }
      return { data: parseAs === 'json' ? null : '', error: lastError } as FetchResult<unknown>;
    }

    if (!response.ok) {
      return { data: parseAs === 'json' ? null : '', error: `HTTP ${response.status} ${response.statusText}` } as FetchResult<unknown>;
    }

    try {
      const data = parseAs === 'json' ? await response.json() : await response.text();
      return { data };
    } catch (err) {
      return { data: parseAs === 'json' ? null : '', error: `Failed to read response body: ${String(err)}` } as FetchResult<unknown>;
    }
  }

  return { data: parseAs === 'json' ? null : '', error: lastError || 'Max retries exceeded' } as FetchResult<unknown>;
}

// ── Public fetch helpers ──────────────────────────────────────────────────────
export async function fetchHtml(
  url: string,
  options?: { maxRetries?: number },
): Promise<{ html: string; error?: string }> {
  const result = await fetchWithRetry(url, { parseAs: 'text', maxRetries: options?.maxRetries });
  return { html: result.data as string, error: result.error };
}

export async function fetchJson(
  url: string,
  options?: {
    maxRetries?: number;
    /** HTTP method — defaults to 'GET'. Use 'POST' for APIs that require it. */
    method?: 'GET' | 'POST';
    /** Request body (for POST requests). Will be sent as-is. */
    body?: string;
    /** Extra headers merged on top of the default browser headers. */
    headers?: Record<string, string>;
  },
): Promise<{ data: unknown; error?: string }> {
  const result = await fetchWithRetry(url, {
    parseAs: 'json',
    maxRetries: options?.maxRetries,
    method: options?.method,
    body: options?.body,
    headers: options?.headers,
  });
  return { data: result.data, error: result.error };
}

/**
 * Check whether a URL returns a 404 (Not Found) response.
 * Uses a single HEAD request (no retries) to avoid slow backoff loops.
 * Falls back to GET if the server rejects HEAD (405 Method Not Allowed).
 * Returns `false` for any non-404 outcome (network errors, timeouts, 403, 5xx,
 * etc.) so callers only block on definitively missing pages.
 */
export async function isUrl404(url: string): Promise<boolean> {
  const headers = { 'User-Agent': USER_AGENTS[0] };
  try {
    const headResp = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
      headers,
      redirect: 'follow',
    });
    // Some servers (e.g. Workable's widget API) incorrectly return 404 for HEAD
    // but serve 200 for GET. Always confirm a HEAD 404 with a real GET request.
    if (headResp.status === 404 || headResp.status === 405) {
      const getResp = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(10_000),
        headers,
        redirect: 'follow',
      });
      return getResp.status === 404;
    }
    return false;
  } catch {
    // Network error, timeout, DNS failure — don't block the add
    return false;
  }
}
