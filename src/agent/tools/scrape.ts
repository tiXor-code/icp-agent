import * as cheerio from 'cheerio';
import type { ScrapeResult } from '../../types.js';

const TECH_SIGNATURES: Record<string, RegExp[]> = {
  nextjs: [/__NEXT_DATA__/, /_next\/static/],
  react: [/data-reactroot/, /react-dom/i, /id="root"/],
  vercel: [/x-vercel-id/i, /vercel\.app/i],
  vue: [/data-v-[a-f0-9]+/, /vue\.global/],
  svelte: [/svelte-/],
  stripe: [/js\.stripe\.com/, /pk_(live|test)_/],
  segment: [/cdn\.segment\.com/, /analytics\.load\(/],
  intercom: [/widget\.intercom\.io/, /intercomSettings/],
  hubspot: [/js\.hs-scripts\.com/, /hubspotutk/],
  wordpress: [/wp-content/, /wp-includes/, /generator.*wordpress/i],
  jquery: [/jquery[.-]/i],
  squarespace: [/static1\.squarespace\.com/],
  shopify: [/cdn\.shopify\.com/, /shopify\.theme/i],
  webflow: [/website-files\.com/, /data-wf-page/],
  cloudflare: [/cdnjs\.cloudflare\.com/, /__cf_/i],
};

const SOCIAL_HOSTS: Record<string, RegExp> = {
  linkedin: /linkedin\.com\/(company|in)\/[^\s"'<>]+/i,
  twitter: /(?:twitter|x)\.com\/[^\s"'<>/]+/i,
  facebook: /facebook\.com\/[^\s"'<>/]+/i,
  instagram: /instagram\.com\/[^\s"'<>/]+/i,
  youtube: /youtube\.com\/(channel|c|@)[^\s"'<>]+/i,
  github: /github\.com\/[^\s"'<>/]+/i,
};

const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
const HIRING_HINTS = /\b(we['’]?re hiring|join (our|the) team|open positions|careers|jobs)\b/i;

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

export async function scrape(domain: string): Promise<ScrapeResult> {
  const host = normalizeDomain(domain);
  const url = `https://${host}/`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (icp-agent/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    const html = await res.text();
    if (!res.ok) {
      return {
        url,
        status: res.status,
        title: null,
        description: null,
        text: '',
        tech_signals: [],
        social_links: {},
        emails: [],
        hiring: false,
        blog_links: [],
        error: `http_${res.status}`,
      };
    }
    return parseHtml(url, res.status, html);
  } catch (err) {
    return {
      url,
      status: 0,
      title: null,
      description: null,
      text: '',
      tech_signals: [],
      social_links: {},
      emails: [],
      hiring: false,
      blog_links: [],
      error: err instanceof Error ? err.message : 'fetch_failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function parseHtml(url: string, status: number, html: string): ScrapeResult {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim() || null;
  const description =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    null;

  $('script, style, nav, header, footer, noscript, svg').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 4000);

  const tech_signals: string[] = [];
  for (const [name, patterns] of Object.entries(TECH_SIGNATURES)) {
    if (patterns.some((p) => p.test(html))) tech_signals.push(name);
  }

  const social_links: Record<string, string> = {};
  for (const [platform, re] of Object.entries(SOCIAL_HOSTS)) {
    const m = html.match(re);
    if (m && m[0]) social_links[platform] = m[0].startsWith('http') ? m[0] : `https://${m[0]}`;
  }

  const rawEmails = html.match(EMAIL_RE) ?? [];
  const emails = Array.from(
    new Set(
      rawEmails
        .map((e) => e.toLowerCase())
        .filter((e) => !e.includes('example.com') && !e.includes('sentry.io') && !e.endsWith('.png') && !e.endsWith('.jpg')),
    ),
  ).slice(0, 10);

  const hiring = HIRING_HINTS.test(html) || /\/(careers|jobs|hiring)\b/i.test(html);

  const blog_links = Array.from(
    new Set(
      $('a[href*="/blog"], a[href*="/changelog"], a[href*="/news"]')
        .map((_, el) => $(el).attr('href') || '')
        .get()
        .filter(Boolean),
    ),
  ).slice(0, 10);

  return { url, status, title, description, text, tech_signals, social_links, emails, hiring, blog_links };
}
