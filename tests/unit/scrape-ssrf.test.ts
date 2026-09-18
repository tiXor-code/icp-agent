import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { scrape, _ssrf } from '../../src/agent/tools/scrape.js';

const { ipIsBlocked, assertPublicTarget, pinnedGet } = _ssrf;

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

  it('pins a public IP literal to itself without a network call', async () => {
    await expect(assertPublicTarget(new URL('https://8.8.8.8/'))).resolves.toEqual({ address: '8.8.8.8', family: 4 });
  });
});

// Regression for the DNS-rebinding TOCTOU: assertPublicTarget validates an IP,
// then the outbound connection must go to THAT pinned IP — never a second
// resolution that an attacker's DNS could rebind to an internal address.
describe('SSRF guard: pinnedGet connects to the validated IP, never re-resolves', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`served-to-host:${req.headers.host}`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('reaches the pinned address even though the URL host resolves elsewhere', async () => {
    // Host is a public name whose real DNS points nowhere near this test server.
    // Because the connection is pinned to 127.0.0.1, it lands on our server and
    // the Host header still carries the original hostname (SNI/vhost preserved).
    const url = new URL(`http://example.com:${port}/`);
    const res = await pinnedGet(url, { address: '127.0.0.1', family: 4 }, new AbortController().signal);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`served-to-host:example.com:${port}`);
  });

  it('honours an already-aborted signal instead of connecting', async () => {
    const ac = new AbortController();
    ac.abort();
    const url = new URL(`http://example.com:${port}/`);
    await expect(pinnedGet(url, { address: '127.0.0.1', family: 4 }, ac.signal)).rejects.toThrow(/abort/i);
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
