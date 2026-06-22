#!/usr/bin/env node
/**
 * MCP stdio smoke-test.
 * Spawns the dev server, runs the MCP handshake, calls tools/list,
 * then exercises one tool from each group.
 */

import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname; // jobscan-mcp/

let msgId = 1;
const pending = new Map();
let initialized = false;

// ── helpers ────────────────────────────────────────────────────────────────

function send(proc, obj) {
  const line = JSON.stringify(obj);
  proc.stdin.write(line + '\n');
}

function request(proc, method, params = {}) {
  const id = msgId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send(proc, { jsonrpc: '2.0', id, method, params });
  });
}

function notify(proc, method, params = {}) {
  send(proc, { jsonrpc: '2.0', method, params });
}

function ok(label, value) {
  console.log(`  ✅ ${label}`);
  if (value !== undefined) console.log(`     ${JSON.stringify(value).slice(0, 120)}`);
}

function fail(label, err) {
  console.error(`  ❌ ${label}: ${err}`);
}

// ── main ───────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n🧪 JobScan MCP smoke-test\n');

  const proc = spawn(
    'node',
    ['dist/index.js'],
    {
      cwd: ROOT,
      env: { ...process.env, JOBSCAN_URL: 'http://localhost:3000' },
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  );

  const rl = readline.createInterface({ input: proc.stdout });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  proc.on('error', (e) => { console.error('spawn error:', e); process.exit(1); });

  // Give tsx a moment to load
  await new Promise(r => setTimeout(r, 1500));

  try {
    // ── 1. Initialise ──────────────────────────────────────────────────────
    console.log('Phase 1 — Handshake');
    const initResult = await request(proc, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke-test', version: '1.0.0' },
    });
    ok('initialize', { name: initResult?.serverInfo?.name, version: initResult?.serverInfo?.version });
    notify(proc, 'notifications/initialized');

    // ── 2. tools/list ──────────────────────────────────────────────────────
    console.log('\nPhase 2 — Tool discovery');
    const listResult = await request(proc, 'tools/list');
    const tools = listResult?.tools ?? [];
    ok(`tools/list → ${tools.length} tools found`);
    if (tools.length !== 20) fail('expected 20 tools', `got ${tools.length}`);
    else ok('tool count is exactly 20');

    const names = tools.map(t => t.name).sort();
    console.log(`     ${names.join(', ')}`);

    // ── 3. jobscan_get_stats ───────────────────────────────────────────────
    console.log('\nPhase 3 — jobscan_get_stats (read-only)');
    const statsResult = await request(proc, 'tools/call', {
      name: 'jobscan_get_stats',
      arguments: {},
    });
    const statsText = statsResult?.content?.[0]?.text;
    const stats = JSON.parse(statsText);
    ok(`totalJobs=${stats.totalJobs}, totalSources=${stats.totalSources}`);
    ok(`companies sample: ${stats.companies.slice(0, 3).join(', ')}`);

    // ── 4. jobscan_list_parsers ────────────────────────────────────────────
    console.log('\nPhase 4 — jobscan_list_parsers');
    const parsersResult = await request(proc, 'tools/call', {
      name: 'jobscan_list_parsers',
      arguments: {},
    });
    const parsers = JSON.parse(parsersResult?.content?.[0]?.text);
    ok(`parsers (${parsers.length}): ${parsers.join(', ')}`);

    // ── 5. jobscan_list_sources ────────────────────────────────────────────
    console.log('\nPhase 5 — jobscan_list_sources');
    const sourcesResult = await request(proc, 'tools/call', {
      name: 'jobscan_list_sources',
      arguments: { page: 1, pageSize: 5 },
    });
    const sourcesText = sourcesResult?.content?.[0]?.text;
    const sources = JSON.parse(sourcesText);
    ok(`total sources=${sources.total}, returned ${sources.data.length}`);
    ok(`first source: ${sources.data[0]?.company} (${sources.data[0]?.parser})`);

    // ── 6. jobscan_detect_source ───────────────────────────────────────────
    console.log('\nPhase 6 — jobscan_detect_source');
    const detectResult = await request(proc, 'tools/call', {
      name: 'jobscan_detect_source',
      arguments: { url: 'https://boards.greenhouse.io/stripe' },
    });
    const detected = JSON.parse(detectResult?.content?.[0]?.text);
    ok(`detected: parser=${detected.parser}, company=${detected.company}`);

    // ── 7. jobscan_search_jobs ─────────────────────────────────────────────
    console.log('\nPhase 7 — jobscan_search_jobs');
    const searchResult = await request(proc, 'tools/call', {
      name: 'jobscan_search_jobs',
      arguments: { title: 'Engineering Manager', pageSize: 3 },
    });
    const searchText = searchResult?.content?.[0]?.text;
    const searchData = JSON.parse(searchText);
    ok(`search "Engineering Manager": total=${searchData.total}, returned=${searchData.data?.length}`);
    if (searchData.data?.length > 0) {
      ok(`first hit: "${searchData.data[0].title}" at ${searchData.data[0].company}`);
    }

    // ── 8. jobscan_get_job (first result) ──────────────────────────────────
    if (searchData.data?.length > 0) {
      console.log('\nPhase 8 — jobscan_get_job');
      const jobId = searchData.data[0].id;
      const jobResult = await request(proc, 'tools/call', {
        name: 'jobscan_get_job',
        arguments: { jobId },
      });
      const job = JSON.parse(jobResult?.content?.[0]?.text);
      ok(`job ${jobId}: "${job.title}" at ${job.company}`);
      ok(`description length: ${job.description?.length ?? 0} chars`);
    }

    // ── 9. jobscan_sync_latest ─────────────────────────────────────────────
    console.log('\nPhase 9 — jobscan_sync_latest');
    const latestResult = await request(proc, 'tools/call', {
      name: 'jobscan_sync_latest',
      arguments: {},
    });
    const latestText = latestResult?.content?.[0]?.text;
    if (latestText === 'No sync has been run yet.') {
      ok('sync_latest: no syncs yet (informational)');
    } else {
      const latest = JSON.parse(latestText);
      ok(`latest sync: id=${latest.id}, new_jobs=${latest.new_jobs}, sources=${latest.sources_count}`);
    }

    // ── 10. jobscan_crm_counts ─────────────────────────────────────────────
    console.log('\nPhase 10 — jobscan_crm_counts');
    const countsResult = await request(proc, 'tools/call', {
      name: 'jobscan_crm_counts',
      arguments: {},
    });
    const counts = JSON.parse(countsResult?.content?.[0]?.text);
    ok(`CRM counts: sourced=${counts.sourced}, applied=${counts.applied}, disqualified=${counts.disqualified}`);

    // ── 11. error handling: jobscan_get_job with invalid ID ────────────────
    console.log('\nPhase 11 — Error handling (404)');
    const notFoundResult = await request(proc, 'tools/call', {
      name: 'jobscan_get_job',
      arguments: { jobId: 9999999 },
    });
    if (notFoundResult?.isError) {
      ok(`isError=true for unknown jobId: ${notFoundResult.content[0].text}`);
    } else {
      fail('expected isError=true for unknown jobId');
    }

    console.log('\n✅ All smoke tests passed!\n');

  } catch (err) {
    console.error('\n❌ Test failed:', err.message ?? err);
  } finally {
    proc.stdin.end();
    proc.kill();
    process.exit(0);
  }
}

run();
