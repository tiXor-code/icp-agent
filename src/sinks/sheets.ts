import { google } from 'googleapis';
import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

let sheetsClient: ReturnType<typeof google.sheets> | null = null;

function bufferPath(): string {
  return join(tmpdir(), 'icp-agent-sheet-buffer.jsonl');
}

function getSheets(): ReturnType<typeof google.sheets> | null {
  if (sheetsClient) return sheetsClient;
  const env = getEnv();
  if (!env.GOOGLE_SHEETS_ID || !env.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  let creds: { client_email: string; private_key: string };
  try {
    const raw = Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_JSON, 'base64').toString('utf8');
    creds = JSON.parse(raw);
  } catch (err) {
    log().error({ err }, 'sheets_creds_parse_failed');
    return null;
  }
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
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
  const sheets = getSheets();
  if (!sheets) return;
  const env = getEnv();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: env.GOOGLE_SHEETS_ID!,
      range: `${env.GOOGLE_SHEETS_TAB}!A1:R1`,
    });
    const row = res.data.values?.[0];
    if (!row || row.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: env.GOOGLE_SHEETS_ID!,
        range: `${env.GOOGLE_SHEETS_TAB}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADER] },
      });
    }
  } catch (err) {
    log().warn({ err }, 'sheets_header_check_failed');
  }
}

export async function appendInitial(row: InitialRow): Promise<{ row_url: string | null }> {
  const sheets = getSheets();
  const env = getEnv();
  const now = new Date().toISOString();
  const values = [
    now,
    row.lead_id,
    row.email,
    row.domain,
    'processing',
    '', // sequence
    '', // score
    '', // reasoning
    '', // breakdown
    '', // enrichment summary
    '', // deepen actions
    '', // email subject
    '', // email body
    '', // raw_context
    '', // warnings
    '', // error_message
    '', // duration
    '', // token usage
  ];
  if (!sheets) {
    await bufferToDisk({ kind: 'append', row: values });
    return { row_url: null };
  }
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: env.GOOGLE_SHEETS_ID!,
      range: `${env.GOOGLE_SHEETS_TAB}!A:R`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] },
    });
    return { row_url: `https://docs.google.com/spreadsheets/d/${env.GOOGLE_SHEETS_ID}/edit#gid=0` };
  } catch (err) {
    log().warn({ err }, 'sheets_append_failed');
    await bufferToDisk({ kind: 'append', row: values });
    return { row_url: null };
  }
}

export async function updateFinal(row: FinalRow): Promise<void> {
  const sheets = getSheets();
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
  if (!sheets) {
    await bufferToDisk({ kind: 'update', row: values });
    return;
  }
  try {
    const found = await sheets.spreadsheets.values.get({
      spreadsheetId: env.GOOGLE_SHEETS_ID!,
      range: `${env.GOOGLE_SHEETS_TAB}!B:B`,
    });
    const rows = found.data.values ?? [];
    const idx = rows.findIndex((r) => r[0] === row.lead_id);
    if (idx >= 0) {
      const sheetRow = idx + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: env.GOOGLE_SHEETS_ID!,
        range: `${env.GOOGLE_SHEETS_TAB}!A${sheetRow}:R${sheetRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [values] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: env.GOOGLE_SHEETS_ID!,
        range: `${env.GOOGLE_SHEETS_TAB}!A:R`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [values] },
      });
    }
  } catch (err) {
    log().error({ err }, 'sheets_update_failed');
    await bufferToDisk({ kind: 'update', row: values });
  }
}

export async function findByLeadId(lead_id: string): Promise<string[] | null> {
  const sheets = getSheets();
  const env = getEnv();
  if (!sheets) return null;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: env.GOOGLE_SHEETS_ID!,
      range: `${env.GOOGLE_SHEETS_TAB}!A:R`,
    });
    const rows = res.data.values ?? [];
    const found = rows.find((r) => r[1] === lead_id);
    return found ?? null;
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
