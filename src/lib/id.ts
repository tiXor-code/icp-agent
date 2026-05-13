import { customAlphabet } from 'nanoid';
import { createHash } from 'node:crypto';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

export function newLeadId(): string {
  return nanoid();
}

export function idempotencyKey(email: string, domain: string): string {
  const normalized = `${email.trim().toLowerCase()}|${domain.trim().toLowerCase()}`;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}
