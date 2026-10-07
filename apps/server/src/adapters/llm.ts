import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';

export interface LlmTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costInr: number;
  model: string;
}

export interface Llm {
  provider: string;
  model: string;
  complete(system: string, turns: LlmTurn[], opts?: { maxTokens?: number }): Promise<LlmResult>;
}

export interface LlmConfig {
  provider: string;
  model?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
}

export class LlmRefusal extends Error {}

/** OpenAI-compatible endpoints: OpenAI, Gemini, Groq, OpenRouter, Ollama, vLLM, LiteLLM... */
const openAiCompatible: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
  'openai-compatible': { baseUrl: 'http://localhost:4000/v1', model: 'default' },
};

export const providerCatalog = [
  { id: 'default', label: 'Relay default (platform model)', needsKey: false },
  { id: 'extractive', label: 'Extractive (no LLM, free, offline)', needsKey: false },
  { id: 'anthropic', label: 'Anthropic Claude (BYOK)', needsKey: true, model: 'claude-opus-5-5' },
  { id: 'openai', label: 'OpenAI (BYOK)', needsKey: true, model: openAiCompatible.openai!.model },
  { id: 'gemini', label: 'Google Gemini (BYOK)', needsKey: true, model: openAiCompatible.gemini!.model },
  { id: 'groq', label: 'Groq (BYOK)', needsKey: true, model: openAiCompatible.groq!.model },
  { id: 'openrouter', label: 'OpenRouter (BYOK)', needsKey: true, model: openAiCompatible.openrouter!.model },
  { id: 'ollama', label: 'Ollama (self-hosted, open-weight)', needsKey: false, model: openAiCompatible.ollama!.model },
  { id: 'openai-compatible', label: 'Any OpenAI-compatible (LiteLLM, vLLM...)', needsKey: false, model: '' },
];

/** USD per 1M tokens [input, output], for cost-per-resolution analytics. Unknown models count as 0. */
const pricing: [RegExp, number, number][] = [
  [/^claude-fable-5/, 10, 50],
  [/^claude-opus-5-5/, 4, 20],
  [/^claude-opus/, 5, 25],
  [/^claude-sonnet-5/, 2, 10],
  [/^claude-sonnet/, 3, 15],
  [/^claude-haiku-4-5/, 1, 5],
  [/^gpt-4o-mini/, 0.15, 0.6],
  [/^gpt-4o/, 2.5, 10],
  [/^gpt-4\.1-mini/, 0.4, 1.6],
  [/^gemini-2\.5-flash/, 0.3, 2.5],
  [/^gemini-2\.5-pro/, 1.25, 10],
];

export function estimateCostInr(model: string, input: number, output: number): number {
  const p = pricing.find(([re]) => re.test(model));
  if (!p) return 0;
  return ((input * p[1] + output * p[2]) / 1_000_000) * config.usdToInr;
}

// Server-side refusal fallback is supported on these Claude models (Claude API only).
const fallbackModels = /^claude-(fable-5-1|opus-5-5|opus-5$|sonnet-5-5)/;

function anthropicLlm(model: string, apiKey: string, baseUrl?: string | null): Llm {
  const client = new Anthropic({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
  const supportsEffort = !/^claude-haiku|^claude-sonnet-4-5|^claude-3/.test(model);
  return {
    provider: 'anthropic',
    model,
    async complete(system, turns, opts) {
      const params: Record<string, unknown> = {
        model,
        max_tokens: opts?.maxTokens ?? 4000,
        system,
        messages: turns,
      };
      // Support replies are short and latency-sensitive: low effort is the right default.
      if (supportsEffort) params.output_config = { effort: 'low' };
      if (!baseUrl && fallbackModels.test(model)) {
        params.betas = ['server-side-fallback-2026-07-01'];
        params.fallbacks = 'default';
      }
      const res = (await client.beta.messages.create(params as any)) as Anthropic.Beta.BetaMessage;
      if (res.stop_reason === 'refusal') throw new LlmRefusal('Model declined to answer');
      const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      const inputTokens = res.usage.input_tokens;
      const outputTokens = res.usage.output_tokens;
      return { text, inputTokens, outputTokens, costInr: estimateCostInr(res.model ?? model, inputTokens, outputTokens), model: res.model ?? model };
    },
  };
}

function openAiLlm(provider: string, model: string, baseUrl: string, apiKey?: string | null): Llm {
  return {
    provider,
    model,
    async complete(system, turns, opts) {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
          model,
          max_tokens: opts?.maxTokens ?? 1200,
          temperature: 0.2,
          messages: [{ role: 'system', content: system }, ...turns],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`${provider} error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as any;
      const text: string = data.choices?.[0]?.message?.content ?? '';
      const inputTokens = data.usage?.prompt_tokens ?? 0;
      const outputTokens = data.usage?.completion_tokens ?? 0;
      return { text, inputTokens, outputTokens, costInr: estimateCostInr(model, inputTokens, outputTokens), model };
    },
  };
}

/** Returns null for the extractive (no-LLM) engine. */
export function createLlm(cfg: LlmConfig): Llm | null {
  let { provider, model, baseUrl, apiKey } = cfg;
  if (provider === 'default') return createLlm(config.defaultLlm);
  if (!provider || provider === 'extractive') return null;
  if (provider === 'anthropic') {
    if (!apiKey) throw new Error('Anthropic requires an API key');
    return anthropicLlm(model || 'claude-opus-5-5', apiKey, baseUrl);
  }
  const preset = openAiCompatible[provider];
  if (!preset) throw new Error(`Unknown LLM provider: ${provider}`);
  return openAiLlm(provider, model || preset.model, baseUrl || preset.baseUrl, apiKey);
}
