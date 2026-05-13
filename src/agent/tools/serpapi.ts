import { getEnv } from '../../lib/env.js';
import type { SerpapiResult } from '../../types.js';

const BASE = 'https://serpapi.com/search.json';

interface SerpapiResponse {
  organic_results?: Array<{ title?: string; link?: string; snippet?: string; date?: string }>;
  error?: string;
}

async function searchGoogle(query: string, opts: { tbs?: string } = {}): Promise<SerpapiResult> {
  const env = getEnv();
  if (!env.SERPAPI_API_KEY) return { query, snippets: [], error: 'no_api_key' };

  const params = new URLSearchParams({
    engine: 'google',
    q: query,
    api_key: env.SERPAPI_API_KEY,
    num: '5',
  });
  if (opts.tbs) params.set('tbs', opts.tbs);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${BASE}?${params}`, { signal: controller.signal });
    if (res.status === 429) return { query, snippets: [], error: 'rate_limited' };
    if (!res.ok) return { query, snippets: [], error: `http_${res.status}` };
    const json = (await res.json()) as SerpapiResponse;
    if (json.error) return { query, snippets: [], error: json.error };
    const snippets = (json.organic_results ?? []).slice(0, 5).map((r) => ({
      title: r.title ?? '',
      link: r.link ?? '',
      snippet: r.snippet ?? '',
      ...(r.date ? { date: r.date } : {}),
    }));
    return { query, snippets };
  } catch (err) {
    return { query, snippets: [], error: err instanceof Error ? err.message : 'fetch_failed' };
  } finally {
    clearTimeout(timeout);
  }
}

export function searchLinkedIn(company: string): Promise<SerpapiResult> {
  return searchGoogle(`"${company}" site:linkedin.com/company`);
}

export function searchNews(company: string): Promise<SerpapiResult> {
  return searchGoogle(`"${company}" news OR funding OR hiring OR launches`, { tbs: 'qdr:m3' });
}
