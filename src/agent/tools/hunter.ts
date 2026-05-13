import { getEnv } from '../../lib/env.js';
import type { HunterCompany } from '../../types.js';

const BASE = 'https://api.hunter.io/v2';

interface HunterDomainSearchResponse {
  data?: {
    domain?: string;
    organization?: string | null;
    industry?: string | null;
    category?: string | null;
    size?: string | null;
    country?: string | null;
    state?: string | null;
    city?: string | null;
    webmail?: boolean;
    emails?: Array<{
      value: string;
      type: string;
      confidence: number;
      first_name?: string | null;
      last_name?: string | null;
      position?: string | null;
    }>;
  };
  errors?: Array<{ id: string; code: number; details: string }>;
}

export async function domainSearch(domain: string): Promise<HunterCompany> {
  const env = getEnv();
  if (!env.HUNTER_API_KEY) {
    return emptyHunter(domain, 'no_api_key');
  }

  const url = `${BASE}/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${encodeURIComponent(env.HUNTER_API_KEY)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 429) return emptyHunter(domain, 'rate_limited');
    if (res.status === 401) return emptyHunter(domain, 'unauthorized');
    if (!res.ok) return emptyHunter(domain, `http_${res.status}`);

    const json = (await res.json()) as HunterDomainSearchResponse;
    if (json.errors && json.errors.length > 0) {
      return emptyHunter(domain, json.errors[0]!.details);
    }
    const d = json.data ?? {};
    return {
      domain,
      organization: d.organization ?? null,
      industry: d.industry ?? null,
      category: d.category ?? null,
      size: d.size ?? null,
      country: d.country ?? null,
      state: d.state ?? null,
      city: d.city ?? null,
      webmail: !!d.webmail,
      emails: (d.emails ?? []).map((e) => ({
        value: e.value,
        type: e.type,
        confidence: e.confidence,
        first_name: e.first_name ?? undefined,
        last_name: e.last_name ?? undefined,
        position: e.position ?? undefined,
      })),
    };
  } catch (err) {
    return emptyHunter(domain, err instanceof Error ? err.message : 'fetch_failed');
  } finally {
    clearTimeout(timeout);
  }
}

export async function emailFinder(domain: string, firstName: string, lastName: string): Promise<HunterCompany> {
  const env = getEnv();
  if (!env.HUNTER_API_KEY) return emptyHunter(domain, 'no_api_key');
  const url = `${BASE}/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${encodeURIComponent(env.HUNTER_API_KEY)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return emptyHunter(domain, `http_${res.status}`);
    const json = (await res.json()) as { data?: { email?: string; score?: number; position?: string } };
    const e = json.data;
    return {
      domain,
      organization: null,
      industry: null,
      category: null,
      size: null,
      country: null,
      state: null,
      city: null,
      webmail: false,
      emails: e?.email
        ? [{ value: e.email, type: 'personal', confidence: e.score ?? 0, first_name: firstName, last_name: lastName, position: e.position ?? undefined }]
        : [],
    };
  } catch (err) {
    return emptyHunter(domain, err instanceof Error ? err.message : 'fetch_failed');
  }
}

function emptyHunter(domain: string, error: string): HunterCompany {
  return {
    domain,
    organization: null,
    industry: null,
    category: null,
    size: null,
    country: null,
    state: null,
    city: null,
    webmail: false,
    emails: [],
    error,
  };
}
