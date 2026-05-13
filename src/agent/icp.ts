import type { Sequence } from '../types.js';

export interface IcpCriterion {
  id: string;
  name: string;
  weight: number;
  good: string;
  bad: string;
  signals: string[];
}

export const ICP_CRITERIA: readonly IcpCriterion[] = [
  {
    id: 'company_size',
    name: 'Company size (10-200 employees)',
    weight: 2.5,
    good: 'Hunter `size` in 11-50 or 51-200. Sweet spot for SMB SaaS budgets.',
    bad: '<10 employees (insufficient budget) or >200 (slow procurement, multi-stakeholder).',
    signals: ['hunter.size', 'linkedin.employees', 'scrape.team_page_count'],
  },
  {
    id: 'industry_fit',
    name: 'Industry fit',
    weight: 2.0,
    good: 'SaaS, dev-tools, e-commerce platforms, B2B agencies, fintech, vertical SaaS.',
    bad: 'Government, Fortune 500 retail, healthcare-clinical, brick-and-mortar service businesses.',
    signals: ['hunter.industry', 'hunter.category', 'scrape.description'],
  },
  {
    id: 'geography',
    name: 'Geography (English-speaking markets)',
    weight: 1.0,
    good: 'US, UK, Canada, Australia, Ireland, Nordics, Netherlands, Germany (English-fluent).',
    bad: 'Non-English primary market — outreach feasibility penalty.',
    signals: ['hunter.country', 'domain.tld', 'scrape.contact_addresses'],
  },
  {
    id: 'tech_stack_modernity',
    name: 'Tech stack modernity',
    weight: 1.5,
    good: 'Next.js / React / Vercel / Stripe / Segment / Linear / modern auth providers — signals a product-thinking team.',
    bad: 'WordPress-only, jQuery, legacy CMS, no JS framework detected.',
    signals: ['scrape.tech_signals'],
  },
  {
    id: 'growth_signals',
    name: 'Growth signals',
    weight: 1.5,
    good: 'Blog/changelog updated within 90 days, hiring page, funding announcements, conference activity.',
    bad: 'Stale blog (>1 year), no hiring page, no news coverage.',
    signals: ['scrape.blog_links', 'scrape.hiring', 'news.snippets'],
  },
  {
    id: 'buyer_reachability',
    name: 'Buyer reachability',
    weight: 1.5,
    good: 'Hunter found at least one verified executive/decision-maker email (CEO, Head of X, Director).',
    bad: 'Only generic contact emails (info@, support@), or no emails at all.',
    signals: ['hunter.emails'],
  },
] as const;

export const MAX_SCORE = ICP_CRITERIA.reduce((sum, c) => sum + c.weight, 0);

export function bandFromScore(score: number): Sequence {
  if (score >= 8) return 'hot';
  if (score >= 4) return 'warm';
  return 'cold';
}

export function shouldSkipCold(score: number): boolean {
  return score <= 2;
}
