// Thin Google Sheets REST client — uses node:crypto for JWT signing + built-in fetch.
// Avoids the `googleapis` SDK, which is huge (~30MB cold start on serverless).

import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSign } from 'node:crypto';
import { getEnv } from '../lib/env.js';
import { log } from '../lib/log.js';
import type { AgentContext, LeadStatus, Sequence } from '../types.js';
import type { ScoreOutput, EmailOutput } from '../agent/schemas.js';

const HEADER = [
  'timestamp_utc',
  'lead_id',
  'email',
  'domain',
  'status',
  'sequence',
  'score',
  'scoring_reasoning',
  'criteria_breakdown_json',
  'enrichment_summary',
  'deepen_actions_taken',
  'email_subject',
  'email_body',
  'raw_context_json',
  'warnings',
  'error_message',
  'duration_ms',
  'token_usage_json',
];

export interface InitialRow {
  lead_id: string;
  email: string;
  domain: string;
}

export interface FinalRow {
  lead_id: string;
  status: LeadStatus;
  sequence: Sequence | null;
  score: number | null;
  scoring?: ScoreOutput;
  email?: EmailOutput;
  enrichment_summary: string;
  deepen_actions_taken: string[];
  raw_context: AgentContext;
  warnings: string[];
  error_message?: string;
  duration_ms: number;
  token_usage: Record<string, { in: number; out: number; cache_read?: number; cache_write?: number }>;
}

interface ServiceAccountCreds {
  client_email: string;
  private_key: string;
}

let creds: ServiceAccountCreds | null = null;
let cachedToken: { token: string; exp: number } | null = null;

function bufferPath(): string {
  return join(tmpdir(), 'icp-agent-sheet-buffer.jsonl');
}

function isConfigured(): boolean {
  const env = getEnv();
  return !!(env.GOOGLE_SHEETS_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

function loadCreds(): ServiceAccountCreds | null {
  if (creds) return creds;
  const env = getEnv();
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  try {
    const raw = Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_JSON, 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) return null;
    creds = { client_email: parsed.client_email, private_key: parsed.private_key };
    return creds;
  } catch (err) {
    log().error({ err }, 'sheets_creds_parse_failed');
    return null;
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.exp - 60 > Math.floor(Date.now() / 1000)) {
    return cachedToken.token;
  }
  const c = loadCreds();
  if (!c) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: c.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const sig = base64url(signer.sign(c.private_key));
  const assertion = `${header}.${payload}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    log().warn({ status: res.status, body: await res.text() }, 'sheets_token_failed');
    return null;
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, exp: now + json.expires_in };
  return cachedToken.token;
}

async function sheetsApi(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<Response | null> {
  const env = getEnv();
  if (!env.GOOGLE_SHEETS_ID) return null;
  const token = await getAccessToken();
  if (!token) return null;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEETS_ID}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return res;
}

async function bufferToDisk(payload: object): Promise<void> {
  try {
    await mkdir(tmpdir(), { recursive: true });
    await appendFile(bufferPath(), JSON.stringify(payload) + '\n', 'utf8');
  } catch (err) {
    log().error({ err }, 'sheets_buffer_write_failed');
  }
}

export async function ensureHeader(): Promise<void> {
  if (!isConfigured()) return;
  const env = getEnv();
  try {
    const get = await sheetsApi('GET', `/values/${encodeURIComponent(env.GOOGLE_SHEETS_TAB)}!A1:R1`);
    if (!get) return;
    if (get.status === 200) {
      const json = (await get.json()) as { values?: string[][] };
      if (json.values && json.values[0] && json.values[0].length > 0) return;
    }
    await sheetsApi(
      'PUT',
      `/values/${encodeURIComponent(env.GOOGLE_SHEETS_TAB)}!A1?valueInputOption=RAW`,
      { values: [HEADER] },
    );
  } catch (err) {
    log().warn({ err }, 'sheets_header_check_failed');
  }
}

export async function appendInitial(row: InitialRow): Promise<{ row_url: string | null }> {
  if (!isConfigured()) {
    await bufferToDisk({ kind: 'append', row });
    return { row_url: null };
  }
  const env = getEnv();
  const now = new Date().toISOString();
  const values = [now, row.lead_id, row.email, row.domain, 'processing', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  try {
    const res = await sheetsApi(
      'POST',
      `/values/${encodeURIComponent(env.GOOGLE_SHEETS_TAB)}!A:R:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: [values] },
    );
    if (!res || !res.ok) {
      log().warn({ status: res?.status }, 'sheets_append_failed');
      await bufferToDisk({ kind: 'append', row: values });
      return { row_url: null };
    }
    return { row_url: `https://docs.google.com/spreadsheets/d/${env.GOOGLE_SHEETS_ID}/edit#gid=0` };
  } catch (err) {
    log().warn({ err }, 'sheets_append_failed');
    await bufferToDisk({ kind: 'append', row: values });
    return { row_url: null };
  }
}

export async function updateFinal(row: FinalRow): Promise<void> {
  const env = getEnv();
  const values = [
    new Date().toISOString(),
    row.lead_id,
    row.raw_context.email,
    row.raw_context.domain,
    row.status,
    row.sequence ?? '',
    row.score ?? '',
    row.scoring?.reasoning ?? '',
    row.scoring ? JSON.stringify(row.scoring.criteria_breakdown) : '',
    row.enrichment_summary,
    row.deepen_actions_taken.join(','),
    row.email?.subject ?? '',
    row.email?.body ?? '',
    truncate(JSON.stringify(row.raw_context), 50_000),
    row.warnings.join(','),
    row.error_message ?? '',
    row.duration_ms,
    JSON.stringify(row.token_usage),
  ];
  if (!isConfigured()) {
    await bufferToDisk({ kind: 'update', row: values });
    return;
  }
  try {
    const found = await sheetsApi('GET', `/values/${encodeURIComponent(env.GOOGLE_SHEETS_TAB)}!B:B`);
    if (!found || !found.ok) {
      await bufferToDisk({ kind: 'update', row: values });
      return;
    }
    const json = (await found.json()) as { values?: string[][] };
    const rows = json.values ?? [];
    const idx = rows.findIndex((r) => r[0] === row.lead_id);
    if (idx >= 0) {
      const sheetRow = idx + 1;
      await sheetsApi(
        'PUT',
        `/values/${encodeURIComponent(env.GOOGLE_SHEETS_TAB)}!A${sheetRow}:R${sheetRow}?valueInputOption=RAW`,
        { values: [values] },
      );
    } else {
      await sheetsApi(
        'POST',
        `/values/${encodeURIComponent(env.GOOGLE_SHEETS_TAB)}!A:R:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { values: [values] },
      );
    }
  } catch (err) {
    log().error({ err }, 'sheets_update_failed');
    await bufferToDisk({ kind: 'update', row: values });
  }
}

export async function findByLeadId(lead_id: string): Promise<string[] | null> {
  if (!isConfigured()) return null;
  const env = getEnv();
  try {
    const res = await sheetsApi('GET', `/values/${encodeURIComponent(env.GOOGLE_SHEETS_TAB)}!A:R`);
    if (!res || !res.ok) return null;
    const json = (await res.json()) as { values?: string[][] };
    const rows = json.values ?? [];
    return rows.find((r) => r[1] === lead_id) ?? null;
  } catch (err) {
    log().warn({ err }, 'sheets_lookup_failed');
    return null;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 12) + '...truncated';
}

export async function readBuffer(): Promise<string> {
  try {
    return await readFile(bufferPath(), 'utf8');
  } catch {
    return '';
  }
}

export const HEADER_COLUMNS = HEADER;
