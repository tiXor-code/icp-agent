import { AzureOpenAI } from 'openai';
import { z } from 'zod';
import { getEnv } from '../lib/env.js';
import { log } from '../lib/log.js';
import { SYSTEM_PROMPT, ASSESS_PROMPT, SCORE_PROMPT, EMAIL_PROMPTS } from './prompts.js';
import { AssessOutputSchema, ScoreOutputSchema, EmailOutputSchema } from './schemas.js';
import type { AgentContext, Sequence } from '../types.js';
import type { AssessOutput, ScoreOutput, EmailOutput } from './schemas.js';

let client: AzureOpenAI | null = null;

function getClient(): AzureOpenAI {
  if (client) return client;
  const env = getEnv();
  if (!env.AZURE_OPENAI_ENDPOINT || !env.AZURE_OPENAI_API_KEY) {
    throw new Error('Configure AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY');
  }
  log().info({ deployment: env.AZURE_OPENAI_DEPLOYMENT, apiVersion: env.AZURE_OPENAI_API_VERSION }, 'llm_init_azure');
  client = new AzureOpenAI({
    endpoint: env.AZURE_OPENAI_ENDPOINT,
    apiKey: env.AZURE_OPENAI_API_KEY,
    apiVersion: env.AZURE_OPENAI_API_VERSION,
    deployment: env.AZURE_OPENAI_DEPLOYMENT,
  });
  return client;
}

interface LlmCallResult<T> {
  data: T;
  usage: { input_tokens: number; output_tokens: number };
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

  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: `${opts.userPrompt}\n\n--- CONTEXT ---\n${opts.context}` },
  ];

  let lastError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const messagesForCall =
      attempt === 0
        ? messages
        : [
            ...messages,
            { role: 'assistant' as const, content: 'Previous output was invalid JSON.' },
            { role: 'user' as const, content: `Your previous reply did not match the required schema (error: ${lastError}). Output ONLY valid JSON matching the schema. No prose, no markdown fences.` },
          ];
    const res = await a.chat.completions.create({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      messages: messagesForCall,
      response_format: { type: 'json_object' },
      max_tokens: opts.max_tokens ?? 2048,
      temperature: 0.3,
    });
    const text = res.choices[0]?.message?.content?.trim();
    if (!text) {
      lastError = 'empty_response';
      continue;
    }
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      const parsed = JSON.parse(stripped);
      const validated = opts.schema.parse(parsed);
      const usage = {
        input_tokens: res.usage?.prompt_tokens ?? 0,
        output_tokens: res.usage?.completion_tokens ?? 0,
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
  return JSON.stringify(
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
