export type Sequence = 'hot' | 'warm' | 'cold';
export type LeadStatus = 'processing' | 'done' | 'failed';

export type AssessAction = 'score_now' | 'fetch_linkedin' | 'fetch_news' | 'fetch_email_finder';

export interface ScrapeResult {
  url: string;
  status: number;
  title: string | null;
  description: string | null;
  text: string;
  tech_signals: string[];
  social_links: Record<string, string>;
  emails: string[];
  hiring: boolean;
  blog_links: string[];
  error?: string;
}

export interface HunterCompany {
  domain: string;
  organization: string | null;
  industry: string | null;
  category: string | null;
  size: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  emails: Array<{ value: string; type: string; confidence: number; position?: string; first_name?: string; last_name?: string }>;
  webmail: boolean;
  error?: string;
}

export interface SerpapiResult {
  query: string;
  snippets: Array<{ title: string; link: string; snippet: string; date?: string }>;
  error?: string;
}

export interface AgentContext {
  lead_id: string;
  email: string;
  domain: string;
  scrape?: ScrapeResult;
  hunter?: HunterCompany;
  linkedin?: SerpapiResult;
  news?: SerpapiResult;
  email_finder?: HunterCompany;
  warnings: string[];
}
