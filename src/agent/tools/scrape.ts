import net from 'node:net';
import { lookup } from 'node:dns/promises';
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

// --- SSRF guard ---------------------------------------------------------
// The scrape target is attacker-influenced (it comes from the inbound webhook
// domain), so the outbound fetch must never reach private/internal hosts —
// directly, via a DNS record pointed at an internal IP, or via a redirect.

const MAX_REDIRECTS = 5;

// Private / loopback / link-local / reserved ranges that must never be fetched.
const PRIVATE_IP_BLOCKLIST = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], // "this" network / 0.0.0.0
  ['10.0.0.0', 8], // RFC1918 private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // RFC1918 private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // RFC1918 private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
] as const) {
  PRIVATE_IP_BLOCKLIST.addSubnet(addr, prefix, 'ipv4');
}
PRIVATE_IP_BLOCKLIST.addAddress('::1', 'ipv6'); // loopback
PRIVATE_IP_BLOCKLIST.addAddress('::', 'ipv6'); // unspecified
PRIVATE_IP_BLOCKLIST.addSubnet('fc00::', 7, 'ipv6'); // unique local
PRIVATE_IP_BLOCKLIST.addSubnet('fe80::', 10, 'ipv6'); // link-local

function ipIsBlocked(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 0) return true; // not a parseable IP — refuse
  if (kind === 4) return PRIVATE_IP_BLOCKLIST.check(ip, 'ipv4');
  // Unwrap IPv4-mapped IPv6 (e.g. ::ffff:169.254.169.254) and re-check as IPv4.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped && mapped[1]) return ipIsBlocked(mapped[1]);
  return PRIVATE_IP_BLOCKLIST.check(ip, 'ipv6');
}

/**
 * Reject SSRF targets: only http(s), and every IP the host resolves to must be
 * publicly routable. Throws when the target is disallowed.
 */
async function assertPublicTarget(target: URL): Promise<void> {
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new Error('blocked_scheme');
  }
  const host = target.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (ipIsBlocked(host)) throw new Error('blocked_private_target');
    return;
  }
  const resolved = await lookup(host, { all: true });
  if (resolved.length === 0) throw new Error('dns_no_records');
  for (const { address } of resolved) {
    if (ipIsBlocked(address)) throw new Error('blocked_private_target');
  }
}

/**
 * GET a URL while re-validating every hop against the SSRF policy. Redirects are
 * followed manually (undici's automatic follow would skip per-hop validation and
 * allow a public host to bounce into an internal one).
 */
async function safeGet(startUrl: string, signal: AbortSignal): Promise<Response> {
  let current = new URL(startUrl);
  for (let hop = 0; ; hop++) {
    await assertPublicTarget(current);
    const res = await fetch(current, {
      method: 'GET',
      signal,
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (icp-agent/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return res;
      if (hop >= MAX_REDIRECTS) throw new Error('too_many_redirects');
      const next = new URL(location, current);
      if (current.protocol === 'https:' && next.protocol === 'http:') {
        throw new Error('blocked_scheme_downgrade');
      }
      // Drain the redirect body so the socket can be reused.
      await res.arrayBuffer().catch(() => undefined);
      current = next;
      continue;
    }
    return res;
  }
}

export const _ssrf = { ipIsBlocked, assertPublicTarget };

export async function scrape(domain: string): Promise<ScrapeResult> {
  const host = normalizeDomain(domain);
  const url = `https://${host}/`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await safeGet(url, controller.signal);
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
