import Anthropic from '@anthropic-ai/sdk';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { getEnv } from '../lib/env.js';
import { log } from '../lib/log.js';
import { SYSTEM_PROMPT, ASSESS_PROMPT, SCORE_PROMPT, EMAIL_PROMPTS } from './prompts.js';
import { AssessOutputSchema, ScoreOutputSchema, EmailOutputSchema } from './schemas.js';
import type { AgentContext, Sequence } from '../types.js';
import type { AssessOutput, ScoreOutput, EmailOutput } from './schemas.js';

let client: Anthropic | null = null;

function readKeychainOAuthToken(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const out = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(out.trim());
    return parsed?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

function getClient(): Anthropic {
  if (client) return client;
  const env = getEnv();

  // 1. Mac-mini OAuth proxy — preferred when set (works on Vercel + locally).
  if (env.ANTHROPIC_BASE_URL && env.ANTHROPIC_PROXY_SECRET) {
    log().info({ baseURL: env.ANTHROPIC_BASE_URL }, 'anthropic_auth_proxy');
    client = new Anthropic({
      apiKey: 'proxy',
      baseURL: env.ANTHROPIC_BASE_URL,
      defaultHeaders: { 'x-proxy-secret': env.ANTHROPIC_PROXY_SECRET },
    });
    return client;
  }

  // 2. Direct Anthropic Console API key.
  if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
    log().info('anthropic_auth_api_key');
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    return client;
  }

  // 3. Local dev fallback — read OAuth from macOS Keychain.
  const oauth = readKeychainOAuthToken();
  if (oauth) {
    log().info('anthropic_auth_oauth_keychain');
    client = new Anthropic({
      authToken: oauth,
      defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
    });
    return client;
  }

  throw new Error(
    'No Anthropic auth available. Set ANTHROPIC_BASE_URL+ANTHROPIC_PROXY_SECRET (proxy), or ANTHROPIC_API_KEY (sk-ant-...), or run `claude` CLI login on macOS to use the subscription locally.',
  );
}

interface LlmCallResult<T> {
  data: T;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

async function callJson<T>(opts: {
  userPrompt: string;
  context: string;
  schema: z.ZodType<T>;
  label: string;
  max_tokens?: number;
}): Promise<LlmCallResult<T>> {
  const env = getEnv();
  const a = getClient();

  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
  ];

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `${opts.userPrompt}\n\n--- CONTEXT ---\n${opts.context}` },
  ];

  let lastError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await a.messages.create({
      model: env.LLM_MODEL,
      max_tokens: opts.max_tokens ?? 2048,
      system: systemBlocks,
      messages: attempt === 0 ? messages : [
        ...messages,
        { role: 'assistant', content: 'Previous output was invalid JSON.' },
        { role: 'user', content: `Your previous reply did not match the required schema (error: ${lastError}). Output ONLY valid JSON matching the schema. No prose, no markdown fences.` },
      ],
    });
    const textBlock = res.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      lastError = 'no_text_block';
      continue;
    }
    const text = textBlock.text.trim();
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      const parsed = JSON.parse(stripped);
      const validated = opts.schema.parse(parsed);
      const usage = {
        input_tokens: res.usage.input_tokens,
        output_tokens: res.usage.output_tokens,
        ...(res.usage.cache_read_input_tokens != null && { cache_read_input_tokens: res.usage.cache_read_input_tokens }),
        ...(res.usage.cache_creation_input_tokens != null && { cache_creation_input_tokens: res.usage.cache_creation_input_tokens }),
      };
      log().debug({ label: opts.label, usage, attempt }, 'llm_ok');
      return { data: validated, usage };
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 200) : 'parse_failed';
      log().warn({ label: opts.label, attempt, lastError }, 'llm_parse_retry');
    }
  }
  throw new Error(`LLM ${opts.label} failed after 2 attempts: ${lastError}`);
}

function summarizeContext(ctx: AgentContext, roundNum: number, maxRounds: number): string {
  const ctxJson = JSON.stringify(
    {
      lead_id: ctx.lead_id,
      email: ctx.email,
      domain: ctx.domain,
      scrape: ctx.scrape && {
        url: ctx.scrape.url,
        status: ctx.scrape.status,
        title: ctx.scrape.title,
        description: ctx.scrape.description,
        text_excerpt: ctx.scrape.text.slice(0, 1500),
        tech_signals: ctx.scrape.tech_signals,
        social_links: ctx.scrape.social_links,
        emails: ctx.scrape.emails,
        hiring: ctx.scrape.hiring,
        blog_links: ctx.scrape.blog_links.slice(0, 5),
        error: ctx.scrape.error,
      },
      hunter: ctx.hunter,
      linkedin: ctx.linkedin,
      news: ctx.news,
      email_finder: ctx.email_finder,
      round: roundNum,
      max_rounds: maxRounds,
    },
    null,
    2,
  );
  return ctxJson;
}

export async function assess(ctx: AgentContext, roundNum: number, maxRounds: number): Promise<LlmCallResult<AssessOutput>> {
  return callJson({
    userPrompt: ASSESS_PROMPT,
    context: summarizeContext(ctx, roundNum, maxRounds),
    schema: AssessOutputSchema,
    label: 'assess',
    max_tokens: 800,
  });
}

export async function score(ctx: AgentContext): Promise<LlmCallResult<ScoreOutput>> {
  return callJson({
    userPrompt: SCORE_PROMPT,
    context: summarizeContext(ctx, -1, -1),
    schema: ScoreOutputSchema,
    label: 'score',
    max_tokens: 2000,
  });
}

export async function email(ctx: AgentContext, scoring: ScoreOutput, sequence: Sequence): Promise<LlmCallResult<EmailOutput>> {
  return callJson({
    userPrompt: EMAIL_PROMPTS[sequence],
    context:
      summarizeContext(ctx, -1, -1) +
      `\n\n--- SCORING ---\n${JSON.stringify(scoring, null, 2)}\n\n--- SEQUENCE ---\n${sequence}`,
    schema: EmailOutputSchema,
    label: `email_${sequence}`,
    max_tokens: 1200,
  });
}
