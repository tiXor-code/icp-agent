import { getEnv } from '../lib/env.js';
import { log } from '../lib/log.js';
import { scrape } from './tools/scrape.js';
import { domainSearch, emailFinder } from './tools/hunter.js';
import { searchLinkedIn, searchNews } from './tools/serpapi.js';
import { assess, score, email as genEmail } from './llm.js';
import { bandFromScore, shouldSkipCold } from './icp.js';
import { updateFinal } from '../sinks/sheets.js';
import type { AgentContext, Sequence } from '../types.js';
import type { AssessOutput } from './schemas.js';

export interface RunInput {
  lead_id: string;
  email: string;
  domain: string;
}

interface ToolUsage {
  in: number;
  out: number;
  cache_read?: number;
  cache_write?: number;
}

function recordUsage(map: Record<string, ToolUsage>, label: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }) {
  const entry: ToolUsage = {
    in: usage.input_tokens,
    out: usage.output_tokens,
  };
  if (usage.cache_read_input_tokens != null) entry.cache_read = usage.cache_read_input_tokens;
  if (usage.cache_creation_input_tokens != null) entry.cache_write = usage.cache_creation_input_tokens;
  map[label] = entry;
}

export async function runAgent(input: RunInput): Promise<void> {
  const start = Date.now();
  const env = getEnv();
  const usage: Record<string, ToolUsage> = {};
  const deepen: string[] = [];

  const ctx: AgentContext = {
    lead_id: input.lead_id,
    email: input.email,
    domain: input.domain,
    warnings: [],
  };

  try {
    log().info({ lead_id: input.lead_id, domain: input.domain }, 'agent_start');

    const [scrapeRes, hunterRes] = await Promise.all([
      scrape(input.domain),
      domainSearch(input.domain),
    ]);
    ctx.scrape = scrapeRes;
    ctx.hunter = hunterRes;
    if (scrapeRes.error) ctx.warnings.push(`scrape:${scrapeRes.error}`);
    if (hunterRes.error) ctx.warnings.push(`hunter:${hunterRes.error}`);

    for (let round = 0; round <= env.MAX_DEEPEN_ROUNDS; round++) {
      const { data: decision, usage: aUsage } = await assess(ctx, round, env.MAX_DEEPEN_ROUNDS);
      recordUsage(usage, `assess_r${round}`, aUsage);
      log().info({ lead_id: input.lead_id, round, decision: decision.action, confidence: decision.confidence }, 'agent_assess');

      if (decision.action === 'score_now' || round === env.MAX_DEEPEN_ROUNDS) {
        if (round === env.MAX_DEEPEN_ROUNDS && decision.action !== 'score_now') {
          ctx.warnings.push('deepen_budget_exhausted');
        }
        break;
      }
      await executeDeepen(ctx, decision, deepen);
    }

    const { data: scoring, usage: sUsage } = await score(ctx);
    recordUsage(usage, 'score', sUsage);

    const sequence = bandFromScore(scoring.score);
    const skip = sequence === 'cold' && shouldSkipCold(scoring.score);

    let emailResult: { subject: string; body: string } | undefined;
    if (!skip) {
      const { data: e, usage: eUsage } = await genEmail(ctx, scoring, sequence);
      recordUsage(usage, `email_${sequence}`, eUsage);
      emailResult = e;
    } else {
      ctx.warnings.push('cold_skipped');
    }

    await updateFinal({
      lead_id: input.lead_id,
      status: 'done',
      sequence,
      score: scoring.score,
      scoring,
      ...(emailResult && { email: emailResult }),
      enrichment_summary: summarizeEnrichment(ctx),
      deepen_actions_taken: deepen,
      raw_context: ctx,
      warnings: ctx.warnings,
      duration_ms: Date.now() - start,
      token_usage: usage,
    });

    log().info({ lead_id: input.lead_id, sequence, score: scoring.score, duration_ms: Date.now() - start }, 'agent_done');
  } catch (err) {
    log().error({ err, lead_id: input.lead_id }, 'agent_failed');
    await updateFinal({
      lead_id: input.lead_id,
      status: 'failed',
      sequence: null,
      score: null,
      enrichment_summary: summarizeEnrichment(ctx),
      deepen_actions_taken: deepen,
      raw_context: ctx,
      warnings: ctx.warnings,
      error_message: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - start,
      token_usage: usage,
    });
  }
}

async function executeDeepen(ctx: AgentContext, decision: AssessOutput, deepen: string[]): Promise<void> {
  deepen.push(decision.action);
  const company = ctx.hunter?.organization || ctx.scrape?.title?.split(/[—–|·-]/)[0]?.trim() || ctx.domain;
  switch (decision.action) {
    case 'fetch_linkedin': {
      const r = await searchLinkedIn(company);
      ctx.linkedin = r;
      if (r.error) ctx.warnings.push(`linkedin:${r.error}`);
      return;
    }
    case 'fetch_news': {
      const r = await searchNews(company);
      ctx.news = r;
      if (r.error) ctx.warnings.push(`news:${r.error}`);
      return;
    }
    case 'fetch_email_finder': {
      const missing = decision.missing_signals.join(' ');
      const nameMatch = missing.match(/([A-Z][a-z]+)\s+([A-Z][a-z]+)/);
      const first = nameMatch?.[1] ?? 'unknown';
      const last = nameMatch?.[2] ?? 'unknown';
      const r = await emailFinder(ctx.domain, first, last);
      ctx.email_finder = r;
      if (r.error) ctx.warnings.push(`email_finder:${r.error}`);
      return;
    }
    case 'score_now':
      return;
  }
}

function summarizeEnrichment(ctx: AgentContext): string {
  const parts: string[] = [];
  if (ctx.scrape?.title) parts.push(`title: ${ctx.scrape.title}`);
  if (ctx.scrape?.description) parts.push(`desc: ${ctx.scrape.description}`);
  if (ctx.scrape?.tech_signals.length) parts.push(`tech: ${ctx.scrape.tech_signals.join(',')}`);
  if (ctx.hunter?.organization) parts.push(`org: ${ctx.hunter.organization}`);
  if (ctx.hunter?.industry) parts.push(`industry: ${ctx.hunter.industry}`);
  if (ctx.hunter?.size) parts.push(`size: ${ctx.hunter.size}`);
  if (ctx.hunter?.country) parts.push(`country: ${ctx.hunter.country}`);
  if (ctx.hunter?.emails.length) parts.push(`hunter_emails: ${ctx.hunter.emails.length}`);
  if (ctx.scrape?.hiring) parts.push('hiring: true');
  return parts.join('; ').slice(0, 500);
}

// Bounded ReAct loop test surface
export const _internals = { executeDeepen, summarizeEnrichment };

// Re-export Sequence for callers
export type { Sequence };
