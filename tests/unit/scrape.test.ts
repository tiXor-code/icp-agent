import { describe, it, expect } from 'vitest';
import { parseHtml } from '../../src/agent/tools/scrape.js';

describe('parseHtml', () => {
  it('extracts title, description, emails, tech signals from a modern site', () => {
    const html = `
      <html>
        <head>
          <title>Acme — Build faster</title>
          <meta name="description" content="The fastest way to ship." />
        </head>
        <body>
          <div id="root"></div>
          <script src="/_next/static/chunks/main.js"></script>
          <script>window.__NEXT_DATA__ = {};</script>
          <a href="https://linkedin.com/company/acme">linkedin</a>
          <a href="/careers">careers</a>
          <a href="/blog/launch">blog post</a>
          <p>Contact us at hello@acme.com</p>
          <p>We're hiring engineers!</p>
          <script src="https://js.stripe.com/v3"></script>
        </body>
      </html>
    `;
    const r = parseHtml('https://acme.com/', 200, html);
    expect(r.title).toBe('Acme — Build faster');
    expect(r.description).toBe('The fastest way to ship.');
    expect(r.tech_signals).toEqual(expect.arrayContaining(['nextjs', 'react', 'stripe']));
    expect(r.social_links.linkedin).toContain('linkedin.com/company/acme');
    expect(r.emails).toContain('hello@acme.com');
    expect(r.hiring).toBe(true);
    expect(r.blog_links).toEqual(expect.arrayContaining(['/blog/launch']));
  });

  it('filters bogus emails (example.com, sentry, image extensions)', () => {
    const html = '<p>Contact dev@example.com or hello@real.com or icon@cdn.com.png</p>';
    const r = parseHtml('https://x.com/', 200, html);
    expect(r.emails).toContain('hello@real.com');
    expect(r.emails).not.toContain('dev@example.com');
  });

  it('returns empty signals for thin/parked content', () => {
    const html = '<html><head><title>Domain For Sale</title></head><body>Parked</body></html>';
    const r = parseHtml('https://parked.com/', 200, html);
    expect(r.tech_signals).toEqual([]);
    expect(r.emails).toEqual([]);
    expect(r.text.length).toBeLessThan(100);
  });

  it('detects WordPress (anti-signal)', () => {
    const html = '<html><head><meta name="generator" content="WordPress 6.4" /></head><body><link href="/wp-content/themes/foo/style.css" /></body></html>';
    const r = parseHtml('https://wp.example.com/', 200, html);
    expect(r.tech_signals).toContain('wordpress');
  });
});
