import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AssessOutput } from '../../src/agent/schemas.js';

// Mock all external modules BEFORE importing anything that depends on them
vi.mock('../../src/agent/tools/scrape.js', () => ({
  scrape: vi.fn(async () => ({
    url: 'https://acme.com/',
    status: 200,
    title: 'Acme',
    description: 'SaaS for X',
    text: 'hello world '.repeat(200),
    tech_signals: ['nextjs', 'react'],
    social_links: { linkedin: 'https://linkedin.com/company/acme' },
    emails: ['hello@acme.com'],
    hiring: true,
    blog_links: ['/blog/launch'],
  })),
}));

vi.mock('../../src/agent/tools/hunter.js', () => ({
  domainSearch: vi.fn(async () => ({
    domain: 'acme.com',
    organization: 'Acme Inc',
    industry: 'Computer Software',
    category: 'B2B',
    size: '51-200',
    country: 'US',
    state: null,
    city: 'San Francisco',
    webmail: false,
    emails: [{ value: 'ceo@acme.com', type: 'personal', confidence: 95, position: 'CEO' }],
  })),
  emailFinder: vi.fn(),
}));

vi.mock('../../src/agent/tools/serpapi.js', () => ({
  searchLinkedIn: vi.fn(async () => ({
    query: 'linkedin',
    snippets: [{ title: 'Acme | LinkedIn', link: 'https://linkedin.com/company/acme', snippet: '80 employees in San Francisco.' }],
  })),
  searchNews: vi.fn(async () => ({
    query: 'news',
    snippets: [{ title: 'Acme raises $10M', link: 'https://example.com/news', snippet: 'Series A.', date: '2025-01-01' }],
  })),
}));

vi.mock('../../src/agent/llm.ts', () => ({
  assess: vi.fn(),
  score: vi.fn(async () => ({
    data: {
      score: 8.4,
      reasoning: 'Strong fit: 51-200, modern stack, hiring, exec email present.',
      criteria_breakdown: [
        { id: 'company_size', score: 2.5, weight: 2.5, evidence: 'hunter.size = 51-200' },
        { id: 'industry_fit', score: 2.0, weight: 2.0, evidence: 'hunter.industry = SaaS' },
        { id: 'geography', score: 1.0, weight: 1.0, evidence: 'hunter.country = US' },
        { id: 'tech_stack_modernity', score: 1.4, weight: 1.5, evidence: 'scrape.tech_signals = nextjs,react' },
        { id: 'growth_signals', score: 1.0, weight: 1.5, evidence: 'scrape.hiring = true' },
        { id: 'buyer_reachability', score: 0.5, weight: 1.5, evidence: 'hunter has 1 exec email' },
      ],
    },
    usage: { input_tokens: 100, output_tokens: 50 },
  })),
  email: vi.fn(async () => ({
    data: { subject: 'Acme + Y', body: 'Hi — saw your hiring page and modern stack...' },
    usage: { input_tokens: 50, output_tokens: 80 },
  })),
}));

vi.mock('../../src/sinks/sheets.js', () => ({
  updateFinal: vi.fn(async () => {}),
  appendInitial: vi.fn(async () => ({ row_url: null })),
  ensureHeader: vi.fn(async () => {}),
  findByLeadId: vi.fn(async () => null),
}));

vi.mock('../../src/lib/env.js', () => ({
  getEnv: () => ({
    AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com/',
    AZURE_OPENAI_API_KEY: 'test',
    AZURE_OPENAI_DEPLOYMENT: 'gpt-4o-mini',
    AZURE_OPENAI_API_VERSION: '2024-10-21',
    MAX_DEEPEN_ROUNDS: 2,
    LOG_LEVEL: 'fatal',
    NODE_ENV: 'test',
    PORT: 3000,
    GOOGLE_SHEETS_TAB: 'Leads',
  }),
  resetEnv: vi.fn(),
}));

import { runAgent } from '../../src/agent/run.js';
import { assess, email } from '../../src/agent/llm.js';
import { updateFinal } from '../../src/sinks/sheets.js';
import { searchLinkedIn } from '../../src/agent/tools/serpapi.js';

const assessMock = vi.mocked(assess);
const updateFinalMock = vi.mocked(updateFinal);
const linkedinMock = vi.mocked(searchLinkedIn);
const emailMock = vi.mocked(email);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function assessResult(action: AssessOutput['action']): { data: AssessOutput; usage: { input_tokens: number; output_tokens: number } } {
  return {
    data: { confidence: action === 'score_now' ? 'high' : 'low', action, missing_signals: [], reasoning: 'test' },
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

describe('runAgent — bounded ReAct loop', () => {
  it('score_now on round 0 skips deepening', async () => {
    assessMock.mockResolvedValueOnce(assessResult('score_now'));
    await runAgent({ lead_id: 'L1', email: 'x@acme.com', domain: 'acme.com' });
    expect(assessMock).toHaveBeenCalledTimes(1);
    expect(linkedinMock).not.toHaveBeenCalled();
    const finalCall = updateFinalMock.mock.calls[0]![0];
    expect(finalCall.status).toBe('done');
    expect(finalCall.sequence).toBe('hot');
    expect(finalCall.deepen_actions_taken).toEqual([]);
  });

  it('fetch_linkedin once then score_now', async () => {
    assessMock
      .mockResolvedValueOnce(assessResult('fetch_linkedin'))
      .mockResolvedValueOnce(assessResult('score_now'));
    await runAgent({ lead_id: 'L2', email: 'x@acme.com', domain: 'acme.com' });
    expect(assessMock).toHaveBeenCalledTimes(2);
    expect(linkedinMock).toHaveBeenCalledTimes(1);
    const finalCall = updateFinalMock.mock.calls[0]![0];
    expect(finalCall.deepen_actions_taken).toEqual(['fetch_linkedin']);
  });

  it('hits MAX_DEEPEN_ROUNDS cap, sets warning', async () => {
    assessMock
      .mockResolvedValueOnce(assessResult('fetch_linkedin'))
      .mockResolvedValueOnce(assessResult('fetch_news'))
      .mockResolvedValueOnce(assessResult('fetch_linkedin'));
    await runAgent({ lead_id: 'L3', email: 'x@acme.com', domain: 'acme.com' });
    expect(assessMock).toHaveBeenCalledTimes(3);
    const finalCall = updateFinalMock.mock.calls[0]![0];
    expect(finalCall.warnings).toContain('deepen_budget_exhausted');
  });

  it('skips email when score <= 2 (cold-skip)', async () => {
    const { score: mockScore } = await import('../../src/agent/llm.js');
    vi.mocked(mockScore).mockResolvedValueOnce({
      data: {
        score: 1.5,
        reasoning: 'thin context, no signals',
        criteria_breakdown: [{ id: 'company_size', score: 0, weight: 2.5, evidence: 'none' }],
      },
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    assessMock.mockResolvedValueOnce(assessResult('score_now'));
    await runAgent({ lead_id: 'L4', email: 'x@y.com', domain: 'parked.com' });
    expect(emailMock).not.toHaveBeenCalled();
    const finalCall = updateFinalMock.mock.calls[0]![0];
    expect(finalCall.warnings).toContain('cold_skipped');
    expect(finalCall.sequence).toBe('cold');
  });
});
