/**
 * llm.ts — LLM service client (Google Gemini API).
 * Only module that communicates with the LLM service.
 */
import { LlmCallResult, CrmJobWithDetails } from './types';

/** Default Gemini model. */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/** Gemini base URL. */
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Resolve the effective Gemini model.
 * Priority: env var GEMINI_MODEL > explicit value > default.
 */
export function resolveLlmModel(settingValue?: string): string {
  return process.env.GEMINI_MODEL || settingValue || DEFAULT_GEMINI_MODEL;
}

/**
 * Response schema for LLM filter calls.
 * reasoning comes first so the model reasons before deciding pass/fail.
 */
export const FILTER_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reasoning: { type: 'STRING' },
    pass: { type: 'BOOLEAN' },
  },
  required: ['reasoning', 'pass'],
  propertyOrdering: ['reasoning', 'pass'],
};

/**
 * Response schema for LLM tier calls.
 * reasoning comes first so the model reasons before assigning a tier.
 */
export const TIER_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reasoning: { type: 'STRING' },
    tier: { type: 'STRING', enum: ['T1', 'T2', 'T3', 'skip'] },
    strengths: { type: 'ARRAY', items: { type: 'STRING' } },
    gaps: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['reasoning', 'tier'],
  propertyOrdering: ['reasoning', 'tier', 'strengths', 'gaps'],
};

/**
 * Call Gemini API with a prompt and return the response.
 * When responseSchema is provided, structured JSON output is enforced.
 */
export async function callGemini(
  prompt: string,
  apiKey: string,
  model: string,
  responseSchema?: object,
): Promise<LlmCallResult> {
  const startMs = Date.now();

  if (!apiKey) {
    return {
      success: false,
      content: '',
      error: 'Gemini API key is not configured. Please set it in CRM Settings.',
      prompt_sent: prompt,
      elapsed_ms: Date.now() - startMs,
    };
  }

  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  const generationConfig: Record<string, unknown> = {};
  if (responseSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = responseSchema;
  }

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  };
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        success: false,
        content: '',
        error: `Gemini returned HTTP ${response.status}: ${text.slice(0, 300)}`,
        prompt_sent: prompt,
        elapsed_ms: Date.now() - startMs,
      };
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const elapsed_ms = Date.now() - startMs;

    return {
      success: true,
      content,
      prompt_sent: prompt,
      tokens_in: data.usageMetadata?.promptTokenCount,
      tokens_out: data.usageMetadata?.candidatesTokenCount,
      elapsed_ms,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error && err.name === 'TimeoutError'
      ? 'Gemini request timed out after 120s'
      : String(err);
    return { success: false, content: '', error: msg, prompt_sent: prompt, elapsed_ms: Date.now() - startMs };
  }
}

/**
 * Test connectivity to the Gemini API.
 */
export async function testGeminiConnection(
  apiKey: string, model: string
): Promise<{ ok: boolean; error?: string; latency_ms?: number; message?: string }> {
  const start = Date.now();
  try {
    const testSchema = {
      type: 'OBJECT',
      properties: { status: { type: 'STRING' } },
      required: ['status'],
    };
    const result = await callGemini(
      'Respond with status: ok',
      apiKey,
      model,
      testSchema,
    );
    const latency_ms = Date.now() - start;
    if (result.success) {
      return { ok: true, latency_ms, message: `Connected in ${latency_ms}ms` };
    }
    return { ok: false, error: result.error };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Format job data for LLM prompt injection.
 */
export function formatJobData(job: CrmJobWithDetails): string {
  return [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location || 'Not specified'}`,
    `Workplace Type: ${job.workplace_type || 'Not specified'}`,
    `Department: ${job.department || 'Not specified'}`,
    `Description:\n${job.description || 'No description available'}`,
  ].join('\n');
}
