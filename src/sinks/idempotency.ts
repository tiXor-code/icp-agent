import { idempotencyKey } from '../lib/id.js';

interface CacheEntry {
  lead_id: string;
  ts: number;
}

const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export function checkAndRecord(email: string, domain: string, lead_id: string): { dedup: false } | { dedup: true; lead_id: string } {
  const key = idempotencyKey(email, domain);
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && now - existing.ts < TTL_MS) {
    return { dedup: true, lead_id: existing.lead_id };
  }
  cache.set(key, { lead_id, ts: now });
  for (const [k, v] of cache) {
    if (now - v.ts > TTL_MS * 5) cache.delete(k);
  }
  return { dedup: false };
}

export function _reset(): void {
  cache.clear();
}
