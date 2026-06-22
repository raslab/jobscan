/**
 * processing.ts — Automated filter → tier pipeline.
 * Singleton async processing queue with DB-backed state.
 */
import * as db from './db/index';
import { callGemini, formatJobData, resolveLlmModel, FILTER_RESPONSE_SCHEMA, TIER_RESPONSE_SCHEMA } from './llm';
import {
  CrmJobWithDetails, CrmFilter, KeywordFilterConfig,
  FilterResult, TierResult, ProcessingStatus, CrmTier,
} from './types';

// ─── In-memory processing state ──────────────────────────────────────────────

let processingStatus: ProcessingStatus = { state: 'idle', current_job: null, error_count: 0 };
let isRunning = false;

export function getProcessingStatus(): ProcessingStatus {
  return { ...processingStatus };
}

/**
 * Called on server start — reset stuck jobs, count errors, kick queue.
 */
export async function initProcessing(): Promise<void> {
  const resetCount = await db.resetProcessingJobs();
  if (resetCount > 0) {
    console.log(`[processing] Reset ${resetCount} stuck jobs to pending`);
  }

  const errored = await db.getErroredCrmJobs();
  processingStatus.error_count = errored.length;

  // Fire-and-forget: don't block server startup on the processing queue
  kickQueue().catch(err => {
    console.error('[processing] kickQueue error during init:', err);
  });
}

/**
 * Trigger processing manually — reset errored → pending, then kick.
 */
export async function triggerProcessing(): Promise<void> {
  const resetCount = await db.resetErroredJobs();
  if (resetCount > 0) {
    console.log(`[processing] Reset ${resetCount} errored jobs to pending`);
    processingStatus.error_count = 0;
  }
  await kickQueue();
}

/**
 * Core processing loop — pick next pending job, process it, repeat.
 */
export async function kickQueue(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    while (true) {
      const job = await db.getNextPendingCrmJob();
      if (!job) break;

      processingStatus.state = 'processing';
      processingStatus.current_job = { id: job.id, company: job.company, title: job.title };

      await db.updateCrmJobProcessingStatus(job.id, 'processing');
      await db.insertCrmEvent({
        crm_job_id: job.id,
        event_type: 'processing_started',
        actor: 'system',
        from_bucket: null,
        to_bucket: null,
        context_data: null,
        comment: null,
        created_at: new Date().toISOString(),
      });

      try {
        if (job.bucket === 'sourced') {
          await runFilterPhase(job);
        }

        // Re-fetch to check if filter phase moved it
        const updated = await db.getCrmJobWithDetails(job.id);
        if (updated && updated.bucket === 'filtered') {
          await runTierPhase(updated);
        }
      } catch (err) {
        await db.updateCrmJobProcessingStatus(job.id, 'error');
        await db.insertCrmEvent({
          crm_job_id: job.id,
          event_type: 'processing_error',
          actor: 'system',
          from_bucket: null,
          to_bucket: null,
          context_data: JSON.stringify({ error: String(err) }),
          comment: null,
          created_at: new Date().toISOString(),
        });
        processingStatus.error_count++;
      }
    }
  } finally {
    isRunning = false;
    processingStatus.state = processingStatus.error_count > 0 ? 'error' : 'idle';
    processingStatus.current_job = null;
  }
}

// ─── Filter Phase ─────────────────────────────────────────────────────────────

async function runFilterPhase(job: CrmJobWithDetails): Promise<void> {
  const filters = await db.getActiveCrmFilters();
  const settings = await db.getCrmSettings();
  const now = () => new Date().toISOString();

  // Separate keyword filters (run first) and LLM filters
  const keywordFilters = filters.filter(f => f.filter_type === 'keyword');
  const llmFilters = filters.filter(f => f.filter_type === 'llm_filter');

  // 1. Keyword filters — short-circuit on first match
  for (const filter of keywordFilters) {
    let config: KeywordFilterConfig;
    try {
      config = JSON.parse(filter.config) as KeywordFilterConfig;
    } catch {
      continue; // skip malformed config
    }

    const match = matchKeywords(job, config);
    if (match.matched) {
      // Disqualify
      await db.updateCrmJobBucket(job.id, 'auto_disqualified', {
        reason: `Keyword filter "${filter.name}": matched "${match.keyword}" in ${match.field}`,
        processingStatus: 'done',
      });
      await db.insertCrmEvent({
        crm_job_id: job.id,
        event_type: 'keyword_disqualified',
        actor: `keyword_filter:${filter.name}`,
        from_bucket: job.bucket,
        to_bucket: 'auto_disqualified',
        context_data: JSON.stringify({
          filter_name: filter.name,
          keyword: match.keyword,
          field: match.field,
          text_snippet: match.text,
        }),
        comment: null,
        created_at: now(),
      });
      return; // short-circuit
    }
  }

  // 2. LLM filters — sequential, short-circuit on fail
  for (const filter of llmFilters) {
    let config: { prompt: string };
    try {
      config = JSON.parse(filter.config);
    } catch {
      continue;
    }

    const prompt = config.prompt.replace(/\{job_data\}/g, formatJobData(job));
    const result = await callGemini(prompt, settings.gemini_api_key || '', resolveLlmModel(settings.llm_model), FILTER_RESPONSE_SCHEMA);

    if (!result.success) {
      await db.updateCrmJobProcessingStatus(job.id, 'error');
      await db.insertCrmEvent({
        crm_job_id: job.id,
        event_type: 'processing_error',
        actor: `llm_filter:${filter.name}`,
        from_bucket: null,
        to_bucket: null,
        context_data: JSON.stringify({
          filter_name: filter.name,
          error: result.error,
          prompt_sent: result.prompt_sent,
          elapsed_ms: result.elapsed_ms,
        }),
        comment: null,
        created_at: now(),
      });
      return;
    }

    // Parse response — strict then lenient
    const parsed = parseLlmFilterResponse(result.content);
    if (parsed === null) {
      // Totally unparseable
      await db.updateCrmJobProcessingStatus(job.id, 'error');
      await db.insertCrmEvent({
        crm_job_id: job.id,
        event_type: 'processing_error',
        actor: `llm_filter:${filter.name}`,
        from_bucket: null,
        to_bucket: null,
        context_data: JSON.stringify({
          filter_name: filter.name,
          error: 'Malformed LLM response — could not parse pass/fail',
          raw_response: result.content,
          prompt_sent: result.prompt_sent,
          elapsed_ms: result.elapsed_ms,
        }),
        comment: null,
        created_at: now(),
      });
      return;
    }

    if (!parsed.pass) {
      // Disqualify
      await db.updateCrmJobBucket(job.id, 'auto_disqualified', {
        reason: `LLM filter "${filter.name}": ${parsed.reason}`,
        processingStatus: 'done',
      });
      await db.insertCrmEvent({
        crm_job_id: job.id,
        event_type: 'llm_filter_failed',
        actor: `llm_filter:${filter.name}`,
        from_bucket: job.bucket,
        to_bucket: 'auto_disqualified',
        context_data: JSON.stringify({
          filter_name: filter.name,
          pass: false,
          reason: parsed.reason,
          raw_response: result.content,
          prompt_sent: result.prompt_sent,
          tokens_in: result.tokens_in,
          tokens_out: result.tokens_out,
          elapsed_ms: result.elapsed_ms,
        }),
        comment: null,
        created_at: now(),
      });
      return;
    }

    // Passed this filter
    await db.insertCrmEvent({
      crm_job_id: job.id,
      event_type: 'llm_filter_passed',
      actor: `llm_filter:${filter.name}`,
      from_bucket: null,
      to_bucket: null,
      context_data: JSON.stringify({
        filter_name: filter.name,
        pass: true,
        reason: parsed.reason,
        raw_response: result.content,
        prompt_sent: result.prompt_sent,
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
        elapsed_ms: result.elapsed_ms,
      }),
      comment: null,
      created_at: now(),
    });
  }

  // All filters passed → move to filtered
  await db.updateCrmJobBucket(job.id, 'filtered', { processingStatus: 'pending' });
  await db.insertCrmEvent({
    crm_job_id: job.id,
    event_type: 'moved',
    actor: 'system',
    from_bucket: job.bucket,
    to_bucket: 'filtered',
    context_data: JSON.stringify({ reason: 'All filters passed' }),
    comment: null,
    created_at: now(),
  });
}

// ─── Tier Phase ───────────────────────────────────────────────────────────────

async function runTierPhase(job: CrmJobWithDetails): Promise<void> {
  const filters = await db.getActiveCrmFilters();
  const settings = await db.getCrmSettings();
  const now = () => new Date().toISOString();

  const tierFilters = filters.filter(f => f.filter_type === 'llm_tier' && f.is_active);

  if (tierFilters.length === 0) {
    // No tier config — move directly to processed with null tier
    await db.updateCrmJobBucket(job.id, 'processed', { tier: null, processingStatus: 'done' });
    await db.insertCrmEvent({
      crm_job_id: job.id,
      event_type: 'moved',
      actor: 'system',
      from_bucket: job.bucket,
      to_bucket: 'processed',
      context_data: JSON.stringify({ reason: 'No tier filter configured' }),
      comment: null,
      created_at: now(),
    });
    return;
  }

  const tierFilter = tierFilters[0]; // Only one active at a time
  let config: { prompt: string };
  try {
    config = JSON.parse(tierFilter.config);
  } catch {
    await db.updateCrmJobProcessingStatus(job.id, 'error');
    await db.insertCrmEvent({
      crm_job_id: job.id,
      event_type: 'processing_error',
      actor: `llm_tier:${tierFilter.name}`,
      from_bucket: null,
      to_bucket: null,
      context_data: JSON.stringify({ error: 'Invalid tier filter config JSON' }),
      comment: null,
      created_at: now(),
    });
    return;
  }

  const prompt = config.prompt.replace(/\{job_data\}/g, formatJobData(job));
  const result = await callGemini(prompt, settings.gemini_api_key || '', resolveLlmModel(settings.llm_model), TIER_RESPONSE_SCHEMA);

  if (!result.success) {
    await db.updateCrmJobProcessingStatus(job.id, 'error');
    await db.insertCrmEvent({
      crm_job_id: job.id,
      event_type: 'processing_error',
      actor: `llm_tier:${tierFilter.name}`,
      from_bucket: null,
      to_bucket: null,
      context_data: JSON.stringify({
        error: result.error,
        prompt_sent: result.prompt_sent,
        elapsed_ms: result.elapsed_ms,
      }),
      comment: null,
      created_at: now(),
    });
    return;
  }

  // Parse tier response — strict then lenient
  const tierResult = parseLlmTierResponse(result.content, result.prompt_sent);
  if (!tierResult) {
    await db.updateCrmJobProcessingStatus(job.id, 'error');
    await db.insertCrmEvent({
      crm_job_id: job.id,
      event_type: 'processing_error',
      actor: `llm_tier:${tierFilter.name}`,
      from_bucket: null,
      to_bucket: null,
      context_data: JSON.stringify({
        error: 'Malformed LLM tier response — could not extract tier',
        raw_response: result.content,
        prompt_sent: result.prompt_sent,
        elapsed_ms: result.elapsed_ms,
      }),
      comment: null,
      created_at: now(),
    });
    return;
  }

  // Success — assign tier and move to processed
  await db.updateCrmJobBucket(job.id, 'processed', {
    tier: tierResult.tier,
    processingStatus: 'done',
  });

  await db.insertCrmEvent({
    crm_job_id: job.id,
    event_type: 'tier_assigned',
    actor: `llm_tier:${tierFilter.name}`,
    from_bucket: job.bucket,
    to_bucket: 'processed',
    context_data: JSON.stringify({
      tier: tierResult.tier,
      reasoning: tierResult.reasoning,
      strengths: tierResult.strengths,
      gaps: tierResult.gaps,
      raw_response: tierResult.raw_response,
      prompt_sent: tierResult.prompt_sent,
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
      elapsed_ms: result.elapsed_ms,
    }),
    comment: null,
    created_at: now(),
  });
}

// ─── Test Filter (no state change) ───────────────────────────────────────────

export async function testFilter(
  filter: CrmFilter, job: CrmJobWithDetails
): Promise<FilterResult> {
  if (filter.filter_type === 'keyword') {
    let config: KeywordFilterConfig;
    try {
      config = JSON.parse(filter.config);
    } catch {
      return { passed: false, reason: 'Invalid filter config', filter_name: filter.name, filter_type: filter.filter_type };
    }
    const match = matchKeywords(job, config);
    return {
      passed: !match.matched,
      reason: match.matched
        ? `Matched keyword "${match.keyword}" in ${match.field}`
        : 'No keywords matched',
      filter_name: filter.name,
      filter_type: filter.filter_type,
      details: match.matched ? { keyword: match.keyword, field: match.field, text: match.text } : undefined,
    };
  }

  if (filter.filter_type === 'llm_filter') {
    let config: { prompt: string };
    try {
      config = JSON.parse(filter.config);
    } catch {
      return { passed: false, reason: 'Invalid filter config', filter_name: filter.name, filter_type: filter.filter_type };
    }
    const settings = await db.getCrmSettings();
    const prompt = config.prompt.replace(/\{job_data\}/g, formatJobData(job));
    const result = await callGemini(prompt, settings.gemini_api_key || '', resolveLlmModel(settings.llm_model), FILTER_RESPONSE_SCHEMA);
    if (!result.success) {
      return { passed: false, reason: result.error || 'LLM call failed', filter_name: filter.name, filter_type: filter.filter_type, details: { elapsed_ms: result.elapsed_ms } };
    }
    const parsed = parseLlmFilterResponse(result.content);
    if (!parsed) {
      return { passed: false, reason: 'Malformed LLM response', filter_name: filter.name, filter_type: filter.filter_type, details: { raw_response: result.content, tokens_in: result.tokens_in, tokens_out: result.tokens_out, elapsed_ms: result.elapsed_ms } };
    }
    return {
      passed: parsed.pass,
      reason: parsed.reason,
      filter_name: filter.name,
      filter_type: filter.filter_type,
      details: { raw_response: result.content, prompt_sent: result.prompt_sent, tokens_in: result.tokens_in, tokens_out: result.tokens_out, elapsed_ms: result.elapsed_ms },
    };
  }

  if (filter.filter_type === 'llm_tier') {
    let config: { prompt: string };
    try {
      config = JSON.parse(filter.config);
    } catch {
      return { passed: false, reason: 'Invalid filter config', filter_name: filter.name, filter_type: filter.filter_type };
    }
    const settings = await db.getCrmSettings();
    const prompt = config.prompt.replace(/\{job_data\}/g, formatJobData(job));
    const result = await callGemini(prompt, settings.gemini_api_key || '', resolveLlmModel(settings.llm_model), TIER_RESPONSE_SCHEMA);
    if (!result.success) {
      return { passed: false, reason: result.error || 'LLM call failed', filter_name: filter.name, filter_type: filter.filter_type, details: { elapsed_ms: result.elapsed_ms } };
    }
    const tierResult = parseLlmTierResponse(result.content, result.prompt_sent);
    if (!tierResult) {
      return { passed: false, reason: 'Malformed LLM tier response', filter_name: filter.name, filter_type: filter.filter_type, details: { raw_response: result.content, tokens_in: result.tokens_in, tokens_out: result.tokens_out, elapsed_ms: result.elapsed_ms } };
    }
    return {
      passed: true,
      reason: `Tier: ${tierResult.tier} — ${tierResult.reasoning}`,
      filter_name: filter.name,
      filter_type: filter.filter_type,
      details: { tier: tierResult.tier, reasoning: tierResult.reasoning, strengths: tierResult.strengths, gaps: tierResult.gaps, raw_response: result.content, tokens_in: result.tokens_in, tokens_out: result.tokens_out, elapsed_ms: result.elapsed_ms },
    };
  }

  return { passed: false, reason: 'Unknown filter type', filter_name: filter.name, filter_type: filter.filter_type };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matchKeywords(
  job: CrmJobWithDetails, config: KeywordFilterConfig
): { matched: boolean; keyword?: string; field?: string; text?: string } {
  const fieldMap: Record<string, string | null> = {
    title: job.title,
    description: job.description,
    company: job.company,
    location: job.location,
    department: job.department,
  };

  if (config.match_mode === 'any') {
    for (const keyword of config.keywords) {
      const kw = keyword.toLowerCase();
      for (const field of config.fields) {
        const value = (fieldMap[field] || '').toLowerCase();
        if (value.includes(kw)) {
          const idx = value.indexOf(kw);
          const snippet = value.slice(Math.max(0, idx - 30), idx + keyword.length + 30);
          return { matched: true, keyword, field, text: snippet };
        }
      }
    }
    return { matched: false };
  }

  // 'all' mode — every keyword must match at least one field
  for (const keyword of config.keywords) {
    const kw = keyword.toLowerCase();
    let found = false;
    for (const field of config.fields) {
      const value = (fieldMap[field] || '').toLowerCase();
      if (value.includes(kw)) {
        found = true;
        break;
      }
    }
    if (!found) return { matched: false };
  }
  // All keywords matched — return info about the first match
  const kw = config.keywords[0].toLowerCase();
  for (const field of config.fields) {
    const value = (fieldMap[field] || '').toLowerCase();
    if (value.includes(kw)) {
      const idx = value.indexOf(kw);
      const snippet = value.slice(Math.max(0, idx - 30), idx + config.keywords[0].length + 30);
      return { matched: true, keyword: config.keywords[0], field, text: snippet };
    }
  }
  return { matched: true, keyword: config.keywords[0], field: config.fields[0] };
}

/**
 * Parse LLM filter response — strict JSON then lenient regex.
 * Accepts both `reasoning` (Gemini schema) and legacy `reason` field.
 */
function parseLlmFilterResponse(content: string): { pass: boolean; reason: string } | null {
  // Strict parse
  try {
    const data = JSON.parse(content);
    if (typeof data.pass === 'boolean') {
      return { pass: data.pass, reason: data.reasoning || data.reason || '' };
    }
  } catch { /* fall through to lenient */ }

  // Lenient: regex extraction
  const passMatch = content.match(/"pass"\s*:\s*(true|false)/i);
  if (passMatch) {
    const pass = passMatch[1].toLowerCase() === 'true';
    const reasonMatch = content.match(/"reason"\s*:\s*"([^"]+)"/);
    return { pass, reason: reasonMatch?.[1] || '' };
  }

  return null;
}

/**
 * Parse LLM tier response — strict JSON then lenient regex.
 */
function parseLlmTierResponse(content: string, promptSent: string): TierResult | null {
  const validTiers = new Set<CrmTier>(['T1', 'T2', 'T3', 'skip']);

  // Strict parse
  try {
    const data = JSON.parse(content);
    const tier = (data.tier || '').toUpperCase();
    const normalizedTier = tier === 'SKIP' ? 'skip' : tier;
    if (validTiers.has(normalizedTier as CrmTier)) {
      return {
        tier: normalizedTier as CrmTier,
        reasoning: data.reasoning || '',
        strengths: Array.isArray(data.strengths) ? data.strengths : [],
        gaps: Array.isArray(data.gaps) ? data.gaps : [],
        raw_response: content,
        prompt_sent: promptSent,
      };
    }
  } catch { /* fall through to lenient */ }

  // Lenient: extract tier from raw text
  const tierMatch = content.match(/\b(T[123]|skip)\b/i);
  if (tierMatch) {
    const raw = tierMatch[1];
    const tier = raw.toLowerCase() === 'skip' ? 'skip' : raw.toUpperCase();
    if (validTiers.has(tier as CrmTier)) {
      return {
        tier: tier as CrmTier,
        reasoning: 'Extracted from raw response (lenient parsing)',
        strengths: [],
        gaps: [],
        raw_response: content,
        prompt_sent: promptSent,
      };
    }
  }

  return null;
}
