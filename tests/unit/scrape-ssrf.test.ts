import { describe, it, expect } from 'vitest';
import { scrape, _ssrf } from '../../src/agent/tools/scrape.js';

const { ipIsBlocked, assertPublicTarget } = _ssrf;

describe('SSRF guard: ipIsBlocked', () => {
  it('blocks loopback, private, link-local and reserved IPv4 ranges', () => {
    for (const ip of [
      '0.0.0.0',
      '10.0.0.5',
      '100.64.1.1',
      '127.0.0.1',
      '169.254.169.254', // cloud metadata
      '172.16.5.5',
      '192.168.1.1',
      '198.18.0.1',
      '224.0.0.1',
    ]) {
      expect(ipIsBlocked(ip), ip).toBe(true);
    }
  });

  it('blocks IPv6 loopback, ULA, link-local and IPv4-mapped internal addresses', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fe80::1', '::ffff:169.254.169.254', '::ffff:127.0.0.1']) {
      expect(ipIsBlocked(ip), ip).toBe(true);
    }
  });

  it('allows public IPs', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(ipIsBlocked(ip), ip).toBe(false);
    }
  });
});

describe('SSRF guard: assertPublicTarget', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicTarget(new URL('file:///etc/passwd'))).rejects.toThrow('blocked_scheme');
    await expect(assertPublicTarget(new URL('gopher://127.0.0.1/'))).rejects.toThrow('blocked_scheme');
  });

  it('rejects IP-literal hosts in private/link-local ranges', async () => {
    await expect(assertPublicTarget(new URL('http://169.254.169.254/latest/meta-data/'))).rejects.toThrow(
      'blocked_private_target',
    );
    await expect(assertPublicTarget(new URL('http://127.0.0.1:6379/'))).rejects.toThrow('blocked_private_target');
    await expect(assertPublicTarget(new URL('http://[::1]/'))).rejects.toThrow('blocked_private_target');
  });

  it('allows a public IP literal without a network call', async () => {
    await expect(assertPublicTarget(new URL('https://8.8.8.8/'))).resolves.toBeUndefined();
  });
});

describe('scrape() end-to-end refuses internal targets before fetching', () => {
  it('returns a blocked error instead of reaching a link-local host', async () => {
    const r = await scrape('169.254.169.254');
    expect(r.error).toBe('blocked_private_target');
    expect(r.status).toBe(0);
    expect(r.text).toBe('');
    expect(r.title).toBeNull();
  });

  it('refuses a loopback host', async () => {
    const r = await scrape('127.0.0.1');
    expect(r.error).toBe('blocked_private_target');
    expect(r.status).toBe(0);
  });
});
